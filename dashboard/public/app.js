// Portfolio dashboard: everything you own on every platform, priced with Avanza's quotes.
// The portfolio is one JSON document in Cloudflare KV behind Cloudflare Access
// (functions/api/portfolio.js); prices come through functions/api/quotes.js and history.js.

const DEFAULT_PLATFORMS = ['Avanza', 'Montrose'];
const QUOTE_REFRESH_MS = 60 * 1000;
const HISTORY_REFRESH_MS = 30 * 60 * 1000;
const BATCH_SIZE = 10; // instruments per API call (see MAX_IDS in the functions)

const RANGES = [
  { key: '1m', label: '1 mån', months: 1, period: 'one_month' },
  { key: '3m', label: '3 mån', months: 3, period: 'three_months' },
  { key: 'ytd', label: 'I år', period: 'this_year' },
  { key: '1y', label: '1 år', months: 12, period: 'one_year' },
  { key: '3y', label: '3 år', months: 36, period: 'three_years' },
  { key: 'all', label: 'Allt' }
];

const KIND_LABEL = { stock: 'Aktie', etf: 'ETF', fund: 'Fond', manual: 'Eget innehav' };
const TYPE_LABEL = { buy: 'Köp', sell: 'Sälj', dividend: 'Utdelning' };
const typeLabel = t => (t.opening ? 'Startläge' : TYPE_LABEL[t.type]);

// --- Formatting ---

const formatters = new Map();
function fmt(value, minDigits = 0, maxDigits = minDigits, extra = {}) {
  const key = `${minDigits}|${maxDigits}|${JSON.stringify(extra)}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('sv-SE', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits, ...extra }));
  }
  return formatters.get(key).format(value);
}
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const kr = (v, digits = 0) => (isNum(v) ? `${fmt(v, digits)} kr` : '–');
const signedKr = v => (isNum(v) ? `${v > 0.5 ? '+' : ''}${fmt(v)} kr` : '–');
const pct = v => (isNum(v) ? `${v > 0.00005 ? '+' : ''}${fmt(v * 100, Math.abs(v) < 0.01 ? 2 : 1)} %` : '–');
const share = v => (isNum(v) ? `${fmt(v * 100, 1)} %` : '–');
const quantity = v => (isNum(v) ? fmt(v, 0, 4) : '–');
const price = v => (isNum(v) ? fmt(v, 2, Math.abs(v) < 10 ? 4 : 2) : '–');
const compact = v => fmt(v, 0, 1, { notation: 'compact' });
const dirClass = v => (isNum(v) && Math.abs(v) > 0.005 ? (v > 0 ? 'up' : 'down') : '');
const dirGlyph = v => (isNum(v) && Math.abs(v) > 0.005 ? (v > 0 ? '▲ ' : '▼ ') : '');

// Accepts "1 234,5", "1234.5" and Unicode minus
function parseNum(text) {
  const clean = String(text ?? '').replace(/[\s ]/g, '').replace(/−/g, '-').replace(',', '.');
  return clean === '' ? NaN : Number(clean);
}
const numInput = v => (isNum(v) ? String(v).replace('.', ',') : '');

// --- Dates (YYYY-MM-DD strings, Swedish time) ---

const today = () => new Date().toLocaleDateString('sv-SE');
const tsToDate = ts => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
const parseDate = date => new Date(`${date}T12:00:00`);
function shiftMonths(date, months) {
  const d = parseDate(date);
  d.setMonth(d.getMonth() - months);
  return d.toLocaleDateString('sv-SE');
}
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const formatDate = (date, options = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  parseDate(date).toLocaleDateString('sv-SE', options);
const formatTime = ts => new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

// --- DOM helpers (text always goes in as text, never as HTML) ---

const $ = id => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  setAttrs(node, attrs);
  return node;
}

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
}

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

function pref(key, fallback) {
  try { return localStorage.getItem(`portfolio.${key}`) ?? fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(`portfolio.${key}`, value); } catch { /* private mode */ }
}

// --- API ---

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      redirect: 'manual',
      cache: 'no-store'
    });
  } catch {
    throw new ApiError('Kunde inte nå servern. Är du uppkopplad?', 0);
  }
  // Cloudflare Access redirects to its login page when the session has expired
  if (response.type === 'opaqueredirect' || response.status === 401) {
    showBanner('Inloggningen har gått ut.', 'Logga in igen', () => location.reload());
    throw new ApiError('Inloggningen har gått ut.', 401);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || `Fel från servern (${response.status})`, response.status, data);
  return data;
}

// --- State ---

const state = {
  data: { instruments: {}, transactions: [], cash: [] },
  version: 0,
  email: '',
  quotes: {},
  fx: { SEK: { rate: 1, prevClose: 1 } },
  quoteErrors: {},
  quotesAt: 0,
  history: {}, // period -> { series: { id: [[ts, close]] }, fx: { USD: [[ts, rate]] }, at }
  total: null,
  range: pref('range', '1y'),
  mode: pref('mode', 'actual'),
  tab: 'holdings',
  view: pref('view', 'overview'),
  countryMode: pref('countryMode', 'lookthrough'),
  dividendYear: null, // the year whose months the dividend chart shows; null = the latest
  details: {}, // Avanza id -> countries, sectors, holdings, category, fee (null if it failed)
  detailsLoading: false,
  valued: [],
  expanded: new Set(),
  showClosed: false,
  sort: { key: pref('sortKey', 'value'), dir: pref('sortDir', 'desc') },
  addingCash: false,
  refreshing: false
};

function normalize(data) {
  return {
    instruments: data && typeof data.instruments === 'object' && !Array.isArray(data.instruments) ? data.instruments : {},
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    cash: Array.isArray(data?.cash) ? data.cash : [] // [{ id, name, platform, amount, updatedAt }]
  };
}

// Applies `change` to a copy of the portfolio and saves it. If another device saved in
// between (409), it starts over from that version and applies the change once more.
async function mutate(change) {
  for (let attempt = 0; ; attempt++) {
    const next = structuredClone(state.data);
    change(next);
    try {
      const { version } = await api('/api/portfolio', { method: 'PUT', body: { baseVersion: state.version, data: next } });
      state.data = next;
      state.version = version;
      break;
    } catch (err) {
      if (err.status === 409 && attempt === 0 && err.data) {
        state.data = normalize(err.data.data);
        state.version = err.data.version;
        continue;
      }
      throw err;
    }
  }
  render();
  refreshQuotes().then(loadChart);
}

// --- Portfolio maths (average cost method, the same GAV the platforms show) ---

function sortedTransactions(transactions) {
  return [...transactions].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
}

const tradeAmount = t => t.quantity * t.price * (t.fxRate || 1);

// What a transaction moved in kronor: paid for a buy, received for a sell or dividend
function cashAmount(t) {
  if (t.type === 'buy') return tradeAmount(t) + (t.fee || 0);
  if (t.type === 'sell') return tradeAmount(t) - (t.fee || 0);
  return t.amount;
}

function newPosition(instrumentId, platform) {
  return {
    instrumentId, platform,
    qty: 0, cost: 0, costLocal: 0, invested: 0, realized: 0, dividends: 0, dividendsThisYear: 0,
    qtyBeforeToday: 0, flowToday: 0
  };
}

function applyTransaction(p, t, todayStr) {
  const fx = t.fxRate || 1;
  // A starting position (something owned since before) is never part of today's change
  const isToday = t.date >= todayStr && !t.opening;
  if (t.type === 'buy') {
    const amount = cashAmount(t);
    p.qty += t.quantity;
    p.cost += amount;
    p.costLocal += t.quantity * t.price + (t.fee || 0) / fx;
    p.invested += amount;
    if (isToday) p.flowToday += amount;
    else p.qtyBeforeToday += t.quantity;
  } else if (t.type === 'sell') {
    const q = Math.min(t.quantity, p.qty);
    const soldShare = p.qty > 0 ? q / p.qty : 0;
    const proceeds = q * t.price * fx - (t.fee || 0);
    const soldCost = p.cost * soldShare;
    p.realized += proceeds - soldCost;
    p.cost -= soldCost;
    p.costLocal -= p.costLocal * soldShare;
    p.qty -= q;
    if (p.qty < 1e-9) Object.assign(p, { qty: 0, cost: 0, costLocal: 0 });
    if (isToday) p.flowToday -= proceeds;
    else p.qtyBeforeToday = Math.max(0, p.qtyBeforeToday - q);
  } else if (t.type === 'dividend') {
    p.dividends += t.amount;
    if (t.date.slice(0, 4) === todayStr.slice(0, 4)) p.dividendsThisYear += t.amount;
  }
}

// One position per instrument and platform
function computePositions() {
  const todayStr = today();
  const positions = new Map();
  for (const t of sortedTransactions(state.data.transactions)) {
    const key = `${t.instrumentId}|${t.platform}`;
    if (!positions.has(key)) positions.set(key, newPosition(t.instrumentId, t.platform));
    applyTransaction(positions.get(key), t, todayStr);
  }
  return [...positions.values()];
}

// An own holding can follow a similar Avanza fund: its price is that fund's price times a
// factor, which is set again every time you enter a price yourself
function trackedQuote(instrument) {
  const source = state.quotes[instrument.track.id];
  if (!source || !isNum(source.price)) return null;
  const { factor } = instrument.track;
  return {
    price: source.price * factor,
    prevClose: (source.prevClose ?? source.price) * factor,
    currency: instrument.currency || 'SEK',
    time: source.time,
    tracked: true
  };
}

function manualQuote(instrument) {
  if (instrument.track) {
    const tracked = trackedQuote(instrument);
    if (tracked) return tracked;
  }
  const prices = [...(instrument.prices || [])].sort((a, b) => a.date.localeCompare(b.date));
  const last = prices.at(-1);
  if (!last) return null;
  const before = prices.filter(p => p.date < today()).at(-1);
  return {
    price: last.price,
    prevClose: before ? before.price : last.price,
    currency: instrument.currency || 'SEK',
    time: parseDate(last.date).getTime(),
    manual: true
  };
}

function quoteFor(id) {
  const instrument = state.data.instruments[id];
  if (instrument?.kind === 'manual') return manualQuote(instrument);
  return state.quotes[id] || null;
}

// Market value now, change since the previous close and profit, in kronor. A position
// without a price is counted at its cost and flagged, so totals stay sensible.
function valuePosition(p) {
  const q = quoteFor(p.instrumentId);
  const fx = q && state.fx[q.currency];
  const priced = !!(q && isNum(q.price) && fx && isNum(fx.rate));
  let value = p.cost;
  let todayChange = 0;
  if (priced) {
    value = p.qty * q.price * fx.rate;
    const prevValue = p.qtyBeforeToday * (q.prevClose ?? q.price) * (fx.prevClose ?? fx.rate);
    todayChange = value - prevValue - p.flowToday;
  }
  return {
    ...p,
    quote: q,
    stale: !priced && p.qty > 0,
    value,
    today: todayChange,
    profit: value - p.cost + p.realized + p.dividends
  };
}

const SUM_FIELDS = ['qty', 'cost', 'costLocal', 'invested', 'realized', 'dividends', 'dividendsThisYear', 'value', 'today', 'profit'];

function aggregate(positions, keyFn) {
  const groups = new Map();
  for (const p of positions) {
    const key = keyFn(p);
    if (!groups.has(key)) {
      groups.set(key, { key, positions: [], stale: false, ...Object.fromEntries(SUM_FIELDS.map(f => [f, 0])) });
    }
    const g = groups.get(key);
    g.positions.push(p);
    SUM_FIELDS.forEach(f => { g[f] += p[f]; });
    g.stale ||= p.stale;
  }
  for (const g of groups.values()) {
    const base = g.value - g.today;
    g.todayPct = base > 0 ? g.today / base : null;
    g.profitPct = g.invested > 0 ? g.profit / g.invested : null;
  }
  return [...groups.values()];
}

function emptyTotal() {
  return { positions: [], stale: false, todayPct: null, profitPct: null, ...Object.fromEntries(SUM_FIELDS.map(f => [f, 0])) };
}

// --- Prices ---

// The Avanza orderbook a holding gets its price from, or null for a price you enter yourself
function priceSourceId(id) {
  const track = state.data.instruments[id]?.track;
  if (track) return track.id;
  return id.startsWith('avanza:') ? id : null;
}

// Orderbooks that need a live price: for everything held, plus anything traded today
function quotedIds() {
  const ids = new Set();
  computePositions().forEach(p => { if (p.qty > 0 || p.flowToday !== 0) ids.add(priceSourceId(p.instrumentId)); });
  return [...ids].filter(Boolean);
}

async function refreshQuotes() {
  if (state.refreshing) return;
  const ids = quotedIds();
  if (!ids.length) {
    state.quotesAt = Date.now();
    renderStatus();
    return;
  }
  state.refreshing = true;
  $('refresh').classList.add('spinning');
  try {
    const results = await Promise.all(chunk(ids, BATCH_SIZE).map(batch => api(`/api/quotes?ids=${encodeURIComponent(batch.join(','))}`)));
    const errors = {};
    for (const r of results) {
      Object.assign(state.quotes, r.quotes);
      Object.assign(state.fx, r.fx);
      Object.assign(errors, r.errors);
    }
    state.quoteErrors = errors;
    state.quotesAt = Date.now();
    hideBanner();
    render();
  } catch (err) {
    if (err.status !== 401) showBanner(`Kunde inte hämta kurser: ${err.message}`);
  } finally {
    state.refreshing = false;
    $('refresh').classList.remove('spinning');
  }
}

// --- History & graph data ---

function firstTradeDate() {
  return sortedTransactions(state.data.transactions).find(t => t.type !== 'dividend')?.date || null;
}

function periodCovering(days) {
  if (days <= 28) return 'one_month';
  if (days <= 88) return 'three_months';
  if (days <= 360) return 'one_year';
  if (days <= 3 * 360) return 'three_years';
  if (days <= 5 * 360) return 'five_years';
  return 'infinity';
}

function rangeInfo() {
  const todayStr = today();
  const range = RANGES.find(r => r.key === state.range) || RANGES[3];
  if (range.key === 'ytd') return { start: `${todayStr.slice(0, 4)}-01-01`, period: 'this_year' };
  if (range.months) return { start: shiftMonths(todayStr, range.months), period: range.period };
  if (state.mode === 'current') return { start: '0000-00-00', period: 'five_years' };
  const first = firstTradeDate() || todayStr;
  return { start: first, period: periodCovering(daysBetween(first, todayStr)) };
}

function chartInstruments() {
  if (state.mode === 'current') {
    return [...new Set(computePositions().filter(p => p.qty > 0).map(p => p.instrumentId))];
  }
  return [...new Set(state.data.transactions.filter(t => t.type !== 'dividend').map(t => t.instrumentId))];
}

async function ensureHistory(period, ids, currencies) {
  let h = state.history[period];
  if (!h || Date.now() - h.at > HISTORY_REFRESH_MS) h = state.history[period] = { series: {}, fx: {}, at: Date.now() };
  const missingIds = ids.filter(id => !(id in h.series));
  const missingFx = currencies.filter(c => !(c in h.fx));
  if (!missingIds.length && !missingFx.length) return;

  const batches = missingIds.length ? chunk(missingIds, BATCH_SIZE) : [[]];
  const results = await Promise.all(batches.map((batch, i) => {
    const fx = i === 0 ? missingFx.join(',') : '';
    return api(`/api/history?period=${period}&ids=${encodeURIComponent(batch.join(','))}&fx=${encodeURIComponent(fx)}`);
  }));
  for (const r of results) {
    Object.assign(h.series, r.series);
    Object.assign(h.fx, r.fx);
  }
  // Remember what failed as empty, so every render doesn't ask again
  missingIds.forEach(id => { h.series[id] ||= []; });
  missingFx.forEach(c => { h.fx[c] ||= []; });
}

async function loadChart() {
  const { period } = rangeInfo();
  const ids = [...new Set(chartInstruments().map(priceSourceId).filter(Boolean))];
  const currencies = [...new Set(ids.map(id => state.data.instruments[id]?.currency).filter(c => c && c !== 'SEK'))];
  $('chart').classList.add('loading');
  try {
    await ensureHistory(period, ids, currencies);
  } catch (err) {
    if (err.status !== 401) showBanner(`Kunde inte hämta kurshistorik: ${err.message}`);
  } finally {
    $('chart').classList.remove('loading');
  }
  renderChart();
}

// Lookup in a date-sorted [[date, value]] list that returns the latest value on or before
// the date. Must be called with increasing dates.
function stepper(points) {
  let i = -1;
  return date => {
    while (i + 1 < points.length && points[i + 1][0] <= date) i++;
    return i >= 0 ? points[i][1] : null;
  };
}

const byDate = (a, b) => a[0].localeCompare(b[0]);

function priceSeries(id, h) {
  const instrument = state.data.instruments[id];
  if (instrument?.track) {
    return (h.series[instrument.track.id] || []).map(([ts, close]) => [tsToDate(ts), close * instrument.track.factor]).sort(byDate);
  }
  if (instrument?.kind === 'manual') return (instrument.prices || []).map(p => [p.date, p.price]).sort(byDate);
  return (h.series[id] || []).map(([ts, close]) => [tsToDate(ts), close]).sort(byDate);
}

// [{ date, value, invested }] for the graph. "actual" replays the transactions, so the line
// shows what the portfolio was worth each day; "current" prices today's holdings back in time.
function buildChartSeries() {
  const { start, period } = rangeInfo();
  const h = state.history[period];
  const ids = chartInstruments();
  const todayStr = today();
  if (!h || !ids.length || !state.total) return [];

  const trades = sortedTransactions(state.data.transactions).filter(t => t.type !== 'dividend');
  let from = start;
  if (state.mode === 'actual') {
    if (!trades.length) return [];
    if (trades[0].date > from) from = trades[0].date;
  }

  const dates = new Set();
  const lookups = {};
  for (const id of ids) {
    const points = priceSeries(id, h);
    points.forEach(([date]) => { if (date >= from && date < todayStr) dates.add(date); });
    const currency = state.data.instruments[id]?.currency || 'SEK';
    const fxPoints = currency === 'SEK' ? [] : (h.fx[currency] || []).map(([ts, rate]) => [tsToDate(ts), rate]).sort(byDate);
    lookups[id] = {
      price: stepper(points),
      firstPrice: points[0]?.[1],
      fx: stepper(fxPoints),
      firstFx: fxPoints[0]?.[1] ?? state.fx[currency]?.rate,
      currency
    };
  }
  if (state.mode === 'actual' && from < todayStr) dates.add(from);

  const currentQty = {};
  computePositions().forEach(p => { currentQty[p.instrumentId] = (currentQty[p.instrumentId] || 0) + p.qty; });

  const book = new Map();
  const qtyById = {};
  let next = 0;
  const series = [];
  for (const date of [...dates].sort()) {
    if (state.mode === 'actual') {
      while (next < trades.length && trades[next].date <= date) {
        const t = trades[next++];
        const key = `${t.instrumentId}|${t.platform}`;
        if (!book.has(key)) book.set(key, newPosition(t.instrumentId, t.platform));
        const position = book.get(key);
        const before = position.qty;
        applyTransaction(position, t, todayStr);
        qtyById[t.instrumentId] = (qtyById[t.instrumentId] || 0) + position.qty - before;
      }
    }
    let value = 0;
    for (const id of ids) {
      const qty = state.mode === 'actual' ? qtyById[id] : currentQty[id];
      const L = lookups[id];
      const close = L.price(date) ?? L.firstPrice;
      const rate = L.currency === 'SEK' ? 1 : (L.fx(date) ?? L.firstFx);
      if (qty > 1e-9 && isNum(close) && isNum(rate)) value += qty * close * rate;
    }
    const invested = state.mode === 'actual' ? [...book.values()].reduce((sum, p) => sum + p.cost, 0) : null;
    series.push({ date, value, invested });
  }
  series.push({ date: todayStr, value: state.total.value, invested: state.mode === 'actual' ? state.total.cost : null });
  return series;
}

// --- Rendering ---

function render() {
  const valued = computePositions().map(valuePosition);
  const total = aggregate(valued, () => 'total')[0] || emptyTotal();
  state.total = total;
  state.valued = valued;
  const cash = cashTotal();
  renderStatus();
  renderKpis(total, cash);
  renderPlatforms(aggregate(valued.filter(p => p.qty > 0), p => p.platform), total.value + cash);
  renderCash();
  renderHoldings(aggregate(valued, p => p.instrumentId), total.value + cash);
  renderTransactions();
  renderChart();
  if (state.view === 'analysis') {
    renderAnalysis();
    ensureDetails();
  }
}

function renderStatus() {
  const parts = [];
  if (state.quotesAt) parts.push(`Kurser ${formatTime(state.quotesAt)}`);
  const failed = Object.keys(state.quoteErrors).length;
  if (failed) parts.push(`${failed} kunde inte hämtas`);
  $('status').textContent = parts.join(' · ');
  $('whoami').textContent = state.email ? `Inloggad som ${state.email}` : '';
}

function kpiTile({ label, value, valueClass = '', delta, deltaClass = '', sub, hero = false }) {
  return el('div', { class: `kpi${hero ? ' kpi-hero' : ''}` },
    el('span', { class: 'kpi-label' }, label),
    el('span', { class: `kpi-value ${valueClass}` }, value),
    delta ? el('span', { class: `kpi-delta ${deltaClass}` }, delta) : null,
    sub ? el('span', { class: 'kpi-sub' }, sub) : null
  );
}

function renderKpis(total, cash) {
  const profitParts = [`varav utdelningar ${kr(total.dividends)}`];
  if (Math.abs(total.realized) >= 1) profitParts.push(`sålt ${signedKr(total.realized)}`);
  $('kpis').replaceChildren(
    kpiTile({
      label: 'Totalt värde',
      value: kr(total.value + cash),
      sub: [
        `Anskaffningsvärde ${kr(total.cost)}`,
        cash ? `kontanter ${kr(cash)}` : null,
        total.stale ? 'vissa kurser saknas' : null
      ].filter(Boolean).join(' · '),
      hero: true
    }),
    kpiTile({
      label: 'Idag',
      value: `${dirGlyph(total.today)}${signedKr(total.today)}`,
      valueClass: dirClass(total.today),
      delta: pct(total.todayPct),
      deltaClass: dirClass(total.today)
    }),
    kpiTile({
      label: 'Vinst sedan köp',
      value: `${dirGlyph(total.profit)}${signedKr(total.profit)}`,
      valueClass: dirClass(total.profit),
      delta: pct(total.profitPct),
      deltaClass: dirClass(total.profit),
      sub: profitParts.join(' · ')
    }),
    kpiTile({
      label: 'Utdelningar i år',
      value: kr(total.dividendsThisYear),
      sub: `Totalt ${kr(total.dividends)}`
    })
  );
}

// Holdings plus cash per platform
function renderPlatforms(groups, totalValue) {
  const container = $('platforms');
  const byName = new Map(groups.map(g => [g.key, { key: g.key, value: g.value, today: g.today, cash: 0 }]));
  for (const c of state.data.cash) {
    if (!byName.has(c.platform)) byName.set(c.platform, { key: c.platform, value: 0, today: 0, cash: 0 });
    const p = byName.get(c.platform);
    p.cash += c.amount;
    p.value += c.amount;
  }
  const platforms = [...byName.values()];
  if (!platforms.length) {
    container.replaceChildren(el('p', { class: 'muted' }, 'Inga innehav ännu.'));
    return;
  }
  platforms.sort((a, b) => b.value - a.value);
  const max = Math.max(...platforms.map(p => p.value), 1);
  container.replaceChildren(...platforms.map(p => el('div', { class: 'platform' },
    el('div', { class: 'platform-row' },
      el('span', { class: 'platform-name' }, p.key),
      el('span', { class: 'num' }, kr(p.value))
    ),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar', style: `width:${Math.max(0, (p.value / max) * 100).toFixed(1)}%` })
    ),
    el('div', { class: 'platform-meta' },
      el('span', {}, `${share(totalValue > 0 ? p.value / totalValue : null)} av portföljen${p.cash ? ` · ${kr(p.cash)} kontant` : ''}`),
      el('span', { class: `num ${dirClass(p.today)}` }, `Idag ${signedKr(p.today)}`)
    )
  )));
}

// --- Cash (savings accounts and uninvested money): counts in the total, not in profit ---

function cashTotal() {
  return state.data.cash.reduce((sum, c) => sum + (isNum(c.amount) ? c.amount : 0), 0);
}

async function saveCash(change) {
  try {
    await mutate(data => { change(data.cash); });
  } catch (err) {
    showBanner(`Kunde inte spara: ${err.message}`);
  }
}

function renderCash() {
  const rows = state.data.cash.map(c => {
    const input = el('input', {
      type: 'text', inputmode: 'decimal', value: numInput(c.amount), 'aria-label': `Saldo på ${c.name}, ${c.platform}`,
      onchange: () => {
        const amount = parseNum(input.value);
        if (!isNum(amount)) { input.classList.add('invalid'); return; }
        saveCash(cash => {
          const entry = cash.find(e => e.id === c.id);
          if (entry) Object.assign(entry, { amount, updatedAt: today() });
        });
      },
      onkeydown: e => { if (e.key === 'Enter') input.blur(); }
    });
    return el('div', { class: 'cash-row' },
      el('div', { class: 'cash-name' }, c.name, el('span', { class: 'sub' }, `${c.platform}${c.updatedAt ? ` · ändrat ${formatDate(c.updatedAt)}` : ''}`)),
      el('span', { class: 'cash-amount' }, input, ' kr'),
      el('button', {
        type: 'button', class: 'btn ghost icon small', title: 'Ta bort', 'aria-label': `Ta bort ${c.name}`,
        onclick: () => { if (confirm(`Ta bort ${c.name} (${c.platform})?`)) saveCash(cash => { cash.splice(cash.findIndex(e => e.id === c.id), 1); }); }
      }, '✕')
    );
  });

  const name = el('input', { type: 'text', placeholder: 'Konto, t.ex. Sparkonto', 'aria-label': 'Kontots namn' });
  const platform = el('input', { type: 'text', list: 'cash-platforms', placeholder: 'Plattform', 'aria-label': 'Plattform' });
  const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Belopp', 'aria-label': 'Belopp i kronor' });
  const form = el('form', {
    class: 'cash-add',
    hidden: !state.addingCash,
    onsubmit: e => {
      e.preventDefault();
      const value = parseNum(amount.value);
      [name, platform].forEach(i => i.classList.toggle('invalid', !i.value.trim()));
      amount.classList.toggle('invalid', !isNum(value));
      if (!name.value.trim() || !platform.value.trim() || !isNum(value)) return;
      state.addingCash = false;
      saveCash(cash => { cash.push({ id: crypto.randomUUID(), name: name.value.trim(), platform: platform.value.trim(), amount: value, updatedAt: today() }); });
    }
  },
    name, platform, amount,
    el('datalist', { id: 'cash-platforms' }, platformNames().map(n => el('option', { value: n }))),
    el('button', { type: 'submit', class: 'btn small primary' }, 'Lägg till')
  );
  const addButton = el('button', {
    type: 'button', class: 'btn small', hidden: state.addingCash,
    onclick: () => { state.addingCash = true; renderCash(); $('cash').querySelector('.cash-add input')?.focus(); }
  }, '+ Lägg till konto');

  $('cash').replaceChildren(
    rows.length ? el('div', { class: 'cash-list' }, rows) : el('p', { class: 'muted' }, 'Pengar på sparkonton och likvida medel räknas in i totalen.'),
    form, addButton
  );
}

function instrumentName(id) {
  return state.data.instruments[id]?.name || id;
}

function instrumentCurrency(id) {
  return state.data.instruments[id]?.currency || 'SEK';
}

function renderHoldings(groups, totalValue) {
  const container = $('holdings');
  if (!state.data.transactions.length) {
    $('closed-toggle').hidden = true;
    container.replaceChildren(el('div', { class: 'empty-state' },
      el('p', {}, 'Du har inga innehav inlagda ännu.'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => openTxDialog() }, '+ Lägg till ditt första innehav')
    ));
    return;
  }
  const open = groups.filter(g => g.qty > 0).sort(compareHoldings);
  const closed = groups.filter(g => g.qty === 0).sort(compareHoldings);
  const rows = [];
  for (const g of open) rows.push(...holdingRows(g, totalValue));
  if (state.showClosed) for (const g of closed) rows.push(...holdingRows(g, totalValue));
  if (!rows.length) rows.push(el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'Inga öppna innehav.')));

  $('closed-toggle').hidden = !closed.length;
  container.replaceChildren(el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {},
      sortHeader('name', 'Innehav'),
      sortHeader('qty', 'Antal', 'col-opt'),
      el('th', { class: 'col-opt' }, 'GAV'),
      sortHeader('dayPct', 'Kurs', 'col-opt', 'Sortera på dagens kursändring'),
      sortHeader('value', 'Värde'),
      sortHeader('profit', 'Vinst'),
      el('th', { class: 'col-opt' }, 'Andel')
    )),
    el('tbody', {}, rows)
  )));
}

// Holdings table sorting: click a heading to sort on it, click again to flip the order
const SORT_VALUES = {
  name: g => instrumentName(g.key),
  qty: g => g.qty,
  dayPct: g => {
    const q = g.positions[0].quote;
    return q && isNum(q.price) && q.prevClose > 0 ? q.price / q.prevClose - 1 : null;
  },
  value: g => g.value,
  profit: g => g.profit
};

function compareHoldings(a, b) {
  const { key, dir } = state.sort;
  const valueOf = SORT_VALUES[key] || SORT_VALUES.value;
  const x = valueOf(a);
  const y = valueOf(b);
  if (x == null || y == null) return (x == null) - (y == null); // missing values last
  const order = typeof x === 'string' ? x.localeCompare(y, 'sv') : x - y;
  return dir === 'asc' ? order : -order;
}

function sortHeader(key, label, className = '', title = null) {
  const active = state.sort.key === key;
  const onclick = () => {
    const dir = active ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc');
    state.sort = { key, dir };
    savePref('sortKey', key);
    savePref('sortDir', dir);
    render();
  };
  return el('th', { class: className, 'aria-sort': active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : null },
    el('button', { type: 'button', class: `sort${active ? ' active' : ''}`, title, onclick },
      label, el('span', { class: 'sort-arrow', 'aria-hidden': 'true' }, active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '')
    )
  );
}

function holdingRows(g, totalValue) {
  const id = g.key;
  const instrument = state.data.instruments[id] || {};
  const q = g.positions[0].quote;
  const currency = instrumentCurrency(id);
  const isOpen = state.expanded.has(id);
  const closed = g.qty === 0;
  const dayPct = q && isNum(q.prevClose) && q.prevClose > 0 ? q.price / q.prevClose - 1 : null;
  const platforms = [...new Set(g.positions.filter(p => p.qty > 0 || closed).map(p => p.platform))];

  const row = el('tr', {
    class: `holding${isOpen ? ' open' : ''}${closed ? ' closed-pos' : ''}`,
    tabindex: 0,
    'aria-expanded': String(isOpen),
    onclick: () => toggleExpanded(id),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(id); } }
  },
    el('td', {},
      el('span', { class: 'name' }, el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'), el('span', {}, instrument.name || id)),
      el('span', { class: 'sub' },
        [KIND_LABEL[instrument.kind], platforms.join(', '), closed ? 'Sålt' : null].filter(Boolean).join(' · '),
        g.stale ? el('span', { class: 'warn-dot', title: 'Kurs saknas, räknas till anskaffningsvärdet' }, ' · kurs saknas') : null
      )
    ),
    el('td', { class: 'num col-opt' }, closed ? '–' : quantity(g.qty)),
    el('td', { class: 'num col-opt' }, closed ? '–' : price(g.costLocal / g.qty), closed ? null : el('span', { class: 'cell-sub muted' }, currency)),
    el('td', { class: 'num col-opt' },
      q ? price(q.price) : '–',
      el('span', { class: `cell-sub ${dirClass(dayPct)}` }, q ? `${pct(dayPct)}` : currency)
    ),
    el('td', { class: 'num' },
      kr(g.value),
      closed ? null : el('span', { class: `cell-sub ${dirClass(g.today)}` }, signedKr(g.today))
    ),
    el('td', { class: `num ${dirClass(g.profit)}` },
      signedKr(g.profit),
      el('span', { class: 'cell-sub' }, pct(g.profitPct))
    ),
    el('td', { class: 'num col-opt' }, closed ? '' : share(totalValue > 0 ? g.value / totalValue : null))
  );
  return isOpen ? [row, detailRow(g, instrument, currency)] : [row];
}

function toggleExpanded(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  render();
}

function detailRow(g, instrument, currency) {
  const id = g.key;
  const q = g.positions[0].quote;
  const heldPlatforms = g.positions.filter(p => p.qty > 0);
  const defaultPlatform = heldPlatforms[0]?.platform || g.positions[0].platform;

  const actions = el('div', { class: 'detail-actions' },
    el('button', { type: 'button', class: 'btn small', onclick: () => openTxDialog({ type: 'buy', instrumentId: id, platform: defaultPlatform }) }, 'Köp'),
    heldPlatforms.length ? el('button', { type: 'button', class: 'btn small', onclick: () => openTxDialog({ type: 'sell', instrumentId: id, platform: defaultPlatform }) }, 'Sälj') : null,
    el('button', { type: 'button', class: 'btn small', onclick: () => openTxDialog({ type: 'dividend', instrumentId: id, platform: defaultPlatform }) }, 'Utdelning'),
    instrument.kind === 'manual' ? manualPriceForm(id, q) : null
  );

  let quoteInfo = '';
  if (q?.tracked) quoteInfo = `Kursen följer ${instrument.track.name} (NAV från ${formatDate(tsToDate(q.time))}) sedan du senast satte den själv.`;
  else if (q?.manual) quoteInfo = `Egen kurs, senast satt ${formatDate(tsToDate(q.time))}.`;
  else if (q && instrument.kind === 'fund') quoteInfo = `Fondkurs (NAV) från ${formatDate(tsToDate(q.time))}.`;
  else if (q?.time) quoteInfo = `Senaste avslut ${new Date(q.time).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${q.realTime ? '' : ', fördröjd kurs'}.`;
  if (currency !== 'SEK' && state.fx[currency]) quoteInfo += ` ${currency}/SEK ${price(state.fx[currency].rate)}.`;

  const platformTable = el('div', {},
    el('h3', {}, 'Per plattform'),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Plattform'), el('th', {}, 'Antal'), el('th', {}, 'GAV'), el('th', {}, 'Värde'), el('th', {}, 'Vinst'), el('th', { class: 'col-opt' }, 'Utdelningar'))),
      el('tbody', {}, g.positions.map(p => el('tr', {},
        el('td', {}, p.platform),
        el('td', { class: 'num' }, quantity(p.qty)),
        el('td', { class: 'num' }, p.qty > 0 ? `${price(p.costLocal / p.qty)} ${currency}` : '–'),
        el('td', { class: 'num' }, kr(p.value)),
        el('td', { class: `num ${dirClass(p.profit)}` }, signedKr(p.profit)),
        el('td', { class: 'num col-opt' }, kr(p.dividends))
      )))
    ))
  );

  const txs = sortedTransactions(state.data.transactions.filter(t => t.instrumentId === id)).reverse();
  const txTable = el('div', {},
    el('h3', {}, 'Affärer'),
    transactionTable(txs, false)
  );

  return el('tr', { class: 'detail' }, el('td', { colspan: 7 },
    el('div', { class: 'detail-grid' }, actions, quoteInfo ? el('p', { class: 'hint' }, quoteInfo.trim()) : null, platformTable, txTable)
  ));
}

function manualPriceForm(id, q) {
  const input = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Ny kurs', 'aria-label': 'Ny kurs i kronor', value: q ? numInput(q.price) : '' });
  const save = async () => {
    const value = parseNum(input.value);
    if (!(value >= 0)) { input.classList.add('invalid'); return; }
    try {
      await mutate(data => {
        const instrument = data.instruments[id];
        const todayStr = today();
        instrument.prices = (instrument.prices || []).filter(p => p.date !== todayStr);
        instrument.prices.push({ date: todayStr, price: value });
        const source = instrument.track && state.quotes[instrument.track.id];
        if (source?.price > 0) instrument.track.factor = value / source.price;
      });
    } catch (err) {
      showBanner(`Kunde inte spara: ${err.message}`);
    }
  };
  return el('span', { class: 'manual-price', onclick: e => e.stopPropagation() },
    input,
    el('button', { type: 'button', class: 'btn small', onclick: save }, 'Spara kurs')
  );
}

function transactionTable(txs, showInstrument) {
  if (!txs.length) return el('p', { class: 'muted' }, 'Inga affärer.');
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Datum'),
      el('th', {}, 'Typ'),
      showInstrument ? el('th', {}, 'Värdepapper') : null,
      el('th', { class: showInstrument ? 'col-opt' : '' }, 'Plattform'),
      el('th', { class: 'col-opt' }, 'Antal'),
      el('th', { class: 'col-opt' }, 'Kurs'),
      el('th', {}, 'Belopp')
    )),
    el('tbody', {}, txs.map(t => {
      const amount = cashAmount(t);
      const currency = instrumentCurrency(t.instrumentId);
      return el('tr', {
        class: 'tx',
        tabindex: 0,
        title: 'Ändra affären',
        onclick: e => { e.stopPropagation(); openTxDialog({ tx: t }); },
        onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); openTxDialog({ tx: t }); } }
      },
        el('td', { class: 'num' }, t.date),
        el('td', {}, typeLabel(t), t.note ? el('span', { class: 'sub' }, t.note) : null),
        showInstrument ? el('td', {}, instrumentName(t.instrumentId)) : null,
        el('td', { class: showInstrument ? 'col-opt' : '' }, t.platform),
        el('td', { class: 'num col-opt' }, t.type === 'dividend' ? '' : quantity(t.quantity)),
        el('td', { class: 'num col-opt' }, t.type === 'dividend' ? '' : `${price(t.price)}${currency === 'SEK' ? '' : ` ${currency}`}`),
        el('td', { class: `num ${t.type === 'buy' ? '' : 'up'}` }, `${t.type === 'buy' ? '−' : '+'}${kr(amount)}`)
      );
    }))
  ));
}

function renderTransactions() {
  const txs = sortedTransactions(state.data.transactions).reverse();
  $('transactions').replaceChildren(transactionTable(txs, true));
}

// --- Analysis: what the portfolio is made of, looking through funds and ETFs ---

const regionNames = (() => {
  try { return new Intl.DisplayNames(['sv'], { type: 'region' }); } catch { return null; }
})();

function countryName(code, fallback) {
  let name = null;
  try { name = code ? regionNames?.of(code) : null; } catch { /* unknown code */ }
  return name && name !== code ? name : fallback || code || 'Okänt';
}

function setView(view) {
  state.view = view === 'analysis' ? 'analysis' : 'overview';
  savePref('view', state.view);
  document.querySelectorAll('#view-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  $('view-overview').hidden = state.view !== 'overview';
  $('view-analysis').hidden = state.view !== 'analysis';
  if (state.view === 'analysis') {
    renderAnalysis();
    ensureDetails();
  } else {
    renderChart(); // the graph can't measure itself while hidden
  }
}

// Fetches details for holdings that don't have them yet. A failure is remembered as null,
// so it isn't asked for again on every render (the refresh button starts over).
async function ensureDetails() {
  const ids = [...new Set(computePositions().filter(p => p.qty > 0).map(p => priceSourceId(p.instrumentId)).filter(Boolean))];
  const missing = ids.filter(id => !(id in state.details));
  if (!missing.length || state.detailsLoading) return;
  state.detailsLoading = true;
  renderAnalysis();
  try {
    const results = await Promise.all(chunk(missing, BATCH_SIZE).map(batch => api(`/api/details?ids=${encodeURIComponent(batch.join(','))}`)));
    for (const r of results) Object.assign(state.details, r.details);
  } catch (err) {
    if (err.status !== 401) showBanner(`Kunde inte hämta fonddata: ${err.message}`);
  } finally {
    missing.forEach(id => { if (!(id in state.details)) state.details[id] = null; });
    state.detailsLoading = false;
    renderAnalysis();
  }
}

const ASSET_CLASSES = { stock: 'Aktier', fund: 'Fonder', etf: 'ETF:er', manual: 'Eget innehav' };

// Every open holding with its value and the details it is analysed with: its own, or those
// of the fund an own holding follows
function analysisHoldings() {
  return aggregate(state.valued.filter(p => p.qty > 0), p => p.instrumentId)
    .filter(g => g.value > 0)
    .map(g => {
      const instrument = state.data.instruments[g.key] || {};
      const sourceId = priceSourceId(g.key);
      const details = (sourceId && state.details[sourceId]) || null;
      const isFund = instrument.kind !== 'stock';
      return {
        id: g.key,
        name: instrument.name || g.key,
        instrument,
        value: g.value,
        details,
        isFund,
        assetClass: instrument.kind === 'manual' && instrument.track ? 'Fonder' : ASSET_CLASSES[instrument.kind] || 'Övrigt',
        category: isFund ? instrument.category || details?.category || null : null,
        avanzaFee: details && details.kind !== 'stock' ? details.fee : null,
        fee: isFund ? (isNum(instrument.fee) ? instrument.fee : details?.fee ?? null) : null
      };
    });
}

// Spreads each holding's value over its entries ({ key, label, weight }), scaled so the
// weights add up to the whole holding. Holdings without entries are summed as unknown.
function spread(holdings, entriesOf) {
  const totals = new Map();
  const unknown = [];
  for (const h of holdings) {
    const entries = entriesOf(h) || [];
    const sum = entries.reduce((acc, e) => acc + (e.weight > 0 ? e.weight : 0), 0);
    if (!(sum > 0)) { unknown.push(h); continue; }
    for (const e of entries) {
      if (!(e.weight > 0)) continue;
      if (!totals.has(e.key)) totals.set(e.key, { key: e.key, label: e.label, value: 0 });
      totals.get(e.key).value += h.value * e.weight / sum;
    }
  }
  const rows = [...totals.values()].sort((a, b) => b.value - a.value);
  return { rows, known: rows.reduce((acc, r) => acc + r.value, 0), unknown };
}

const countryEntries = h => (h.details?.countries || []).map(c => ({ key: c.code || c.name, label: countryName(c.code, c.name), weight: c.weight }));

// Where each holding is listed: a share by its company's country, a fund by its category.
// Keyed by name, so Swedish shares and Swedish funds end up on the same "Sverige" row.
function listingEntries(h) {
  if (!h.isFund) return countryEntries(h).map(e => ({ ...e, key: e.label }));
  return h.category ? [{ key: h.category, label: h.category, weight: 1 }] : null;
}

// Companies owned directly and through the funds' largest holdings, summed across everything
function companies(holdings) {
  const byKey = new Map();
  for (const h of holdings) {
    for (const c of h.details?.holdings || []) {
      const key = c.orderbookId || c.name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, name: c.name, value: 0, via: [] });
      const row = byKey.get(key);
      const value = h.value * c.weight / 100;
      row.value += value;
      row.via.push({ name: h.isFund ? h.name : 'direkt', value });
    }
  }
  return [...byKey.values()].sort((a, b) => b.value - a.value);
}

// How much two funds own of the same companies, counted on the largest holdings both report
function overlaps(holdings) {
  const funds = holdings.filter(h => h.isFund && h.details?.holdings?.length);
  const weights = funds.map(h => new Map(h.details.holdings.map(c => [c.orderbookId || c.name.toLowerCase(), c])));
  const pairs = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const common = [];
      for (const [key, a] of weights[i]) {
        const b = weights[j].get(key);
        if (b) common.push({ name: a.name, weight: Math.min(a.weight, b.weight) });
      }
      if (!common.length) continue;
      common.sort((a, b) => b.weight - a.weight);
      pairs.push({ a: funds[i], b: funds[j], overlap: common.reduce((acc, c) => acc + c.weight, 0), common });
    }
  }
  return pairs.sort((x, y) => y.overlap - x.overlap);
}

function barList(rows, base, limit = 10) {
  if (!rows.length) return el('p', { class: 'muted' }, 'Ingen data ännu.');
  let shown = rows;
  if (rows.length > limit + 1) {
    const rest = rows.slice(limit);
    shown = [...rows.slice(0, limit), { key: '', label: `Övriga ${rest.length}`, value: rest.reduce((acc, r) => acc + r.value, 0), other: true }];
  }
  const max = Math.max(...shown.map(r => r.value), 1);
  return el('div', { class: 'bars' }, shown.map(r => el('div', { class: `bar-row${r.other ? ' other' : ''}`, title: `${r.label}: ${kr(r.value)}` },
    el('span', { class: 'bar-label' }, r.label),
    el('span', { class: 'bar-value num' }, share(base > 0 ? r.value / base : null), el('span', { class: 'muted' }, ` · ${kr(r.value)}`)),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' }, el('div', { class: 'bar', style: `width:${Math.max(0, (r.value / max) * 100).toFixed(1)}%` }))
  )));
}

// Which currency a country's shares trade in, for the currency exposure
const EURO = ['DE', 'FR', 'NL', 'ES', 'IT', 'IE', 'FI', 'BE', 'AT', 'PT', 'LU', 'GR', 'SK', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'HR'];
const COUNTRY_CURRENCY = {
  SE: 'SEK', US: 'USD', JP: 'JPY', GB: 'GBP', CH: 'CHF', CA: 'CAD', AU: 'AUD', NO: 'NOK', DK: 'DKK',
  HK: 'HKD', CN: 'CNY', TW: 'TWD', KR: 'KRW', IN: 'INR', SG: 'SGD', NZ: 'NZD', IL: 'ILS', BR: 'BRL', ZA: 'ZAR', MX: 'MXN',
  ...Object.fromEntries(EURO.map(c => [c, 'EUR']))
};
const currencyNames = (() => {
  try { return new Intl.DisplayNames(['sv'], { type: 'currency' }); } catch { return null; }
})();
function currencyLabel(code) {
  let name = null;
  try { name = currencyNames?.of(code); } catch { /* unknown code */ }
  return name && name !== code ? `${code} · ${name}` : code;
}

const currencyEntries = h => (h.details?.countries || []).map(c => {
  const code = COUNTRY_CURRENCY[c.code];
  return { key: code || 'other', label: code ? currencyLabel(code) : 'Övriga valutor', weight: c.weight };
});

const RISK_TEXT = { 1: 'låg', 2: 'låg', 3: 'medel', 4: 'medel', 5: 'hög', 6: 'hög', 7: 'mycket hög' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function monthColumns(values) {
  const max = Math.max(...values, 1);
  return el('div', { class: 'months', role: 'img', 'aria-label': values.map((v, i) => `${MONTHS[i]} ${kr(v)}`).join(', ') },
    values.map((v, i) => el('div', { class: 'month', title: `${MONTHS[i]}: ${kr(v)}` },
      el('span', { class: 'month-value num' }, v > 0 ? (v >= 1000 ? `${fmt(v / 1000, 0, 1)}k` : fmt(v)) : ''),
      el('div', { class: 'month-track' }, el('div', { class: 'month-bar', style: `height:${((v / max) * 100).toFixed(1)}%` })),
      el('span', { class: 'month-label' }, MONTHS[i])
    ))
  );
}

function dividendsCard() {
  const dividends = state.data.transactions.filter(t => t.type === 'dividend' && isNum(t.amount));
  if (!dividends.length) {
    return analysisCard('Utdelningar', el('p', { class: 'muted' }, 'Inga utdelningar inlagda ännu. Lägg in dem som affärer av typen Utdelning.'), { wide: true });
  }
  const byYear = new Map();
  const byInstrument = new Map();
  for (const t of dividends) {
    const year = t.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, Array(12).fill(0));
    byYear.get(year)[Number(t.date.slice(5, 7)) - 1] += t.amount;
    byInstrument.set(t.instrumentId, (byInstrument.get(t.instrumentId) || 0) + t.amount);
  }
  const years = [...byYear.keys()].sort().reverse();
  const year = years.includes(state.dividendYear) ? state.dividendYear : years[0];
  const sum = values => values.reduce((acc, v) => acc + v, 0);
  const total = sum(dividends.map(t => t.amount));
  const yearRows = years.map(y => ({ key: y, label: y, value: sum(byYear.get(y)) }));
  const instrumentRows = [...byInstrument].map(([id, value]) => ({ key: id, label: instrumentName(id), value })).sort((a, b) => b.value - a.value);

  const yearControls = el('div', { class: 'seg', role: 'group', 'aria-label': 'År' }, years.slice(0, 5).map(y => el('button', {
    type: 'button',
    'aria-pressed': String(y === year),
    onclick: () => { state.dividendYear = y; renderAnalysis(); }
  }, y)));

  return analysisCard('Utdelningar', el('div', { class: 'split' },
    el('div', {},
      el('h3', { class: 'mini-head' }, `Per månad ${year} · ${kr(sum(byYear.get(year)))}`),
      monthColumns(byYear.get(year))
    ),
    el('div', {},
      el('h3', { class: 'mini-head' }, 'Per år'),
      barList(yearRows, total, 6),
      el('h3', { class: 'mini-head' }, 'Per innehav, alla år'),
      barList(instrumentRows, total, 6)
    )
  ), { wide: true, controls: years.length > 1 ? yearControls : null });
}

function unknownNote(unknown, what) {
  if (!unknown.length) return null;
  const value = unknown.reduce((acc, h) => acc + h.value, 0);
  return el('p', { class: 'note' }, `${kr(value)} saknar ${what}: ${unknown.map(h => h.name).join(', ')}.`);
}

function analysisCard(title, body, { wide = false, controls = null } = {}) {
  return el('section', { class: `card${wide ? ' wide' : ''}` },
    el('div', { class: 'card-head' }, el('h2', {}, title), controls),
    body
  );
}

async function saveInstrumentField(id, field, value) {
  try {
    await mutate(data => {
      const instrument = data.instruments[id];
      if (!instrument) return;
      if (value == null) delete instrument[field];
      else instrument[field] = value;
    });
  } catch (err) {
    showBanner(`Kunde inte spara: ${err.message}`);
  }
}

function renderAnalysis() {
  const container = $('view-analysis');
  // A refresh while you're typing in the fund table would throw away what you typed
  if (container.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;

  const holdings = analysisHoldings();
  if (!holdings.length) {
    container.replaceChildren(el('section', { class: 'card empty-state' }, el('p', {}, 'Lägg in innehav så visas fördelningen här.')));
    return;
  }
  const invested = holdings.reduce((acc, h) => acc + h.value, 0);
  const cash = cashTotal();
  const funds = holdings.filter(h => h.isFund).sort((a, b) => b.value - a.value);
  const fundValue = funds.reduce((acc, h) => acc + h.value, 0);

  // Asset classes, cash included
  const classes = spread(holdings, h => [{ key: h.assetClass, label: h.assetClass, weight: 1 }]);
  if (cash > 0) classes.rows.push({ key: 'cash', label: 'Kontanter', value: cash });
  classes.rows.sort((a, b) => b.value - a.value);

  const countries = spread(holdings, state.countryMode === 'listing' ? listingEntries : countryEntries);
  const categories = spread(funds, h => [{ key: h.category || '', label: h.category || 'Okategoriserat', weight: 1 }]);
  const sectors = spread(holdings, h => (h.details?.sectors || []).map(s => ({ key: s.name, label: s.name, weight: s.weight })));
  const companyRows = companies(holdings);
  const pairs = overlaps(holdings);
  const lookthrough = spread(holdings, countryEntries);
  const sweden = lookthrough.rows.find(r => r.key === 'SE')?.value || 0;
  const abroadTop = lookthrough.rows.find(r => r.key !== 'SE');

  // Fees: what the funds cost per year at today's value
  const withFee = funds.filter(h => isNum(h.fee));
  const feePerYear = withFee.reduce((acc, h) => acc + h.value * h.fee / 100, 0);
  const feeBase = withFee.reduce((acc, h) => acc + h.value, 0);
  // Currency: what the shares behind everything trade in; cash counts as kronor
  const currencies = spread(holdings, currencyEntries);
  if (cash > 0) {
    const sek = currencies.rows.find(r => r.key === 'SEK');
    if (sek) sek.value += cash;
    else currencies.rows.push({ key: 'SEK', label: currencyLabel('SEK'), value: cash });
    currencies.known += cash;
    currencies.rows.sort((a, b) => b.value - a.value);
  }
  const foreignCurrency = currencies.known > 0 ? 1 - (currencies.rows.find(r => r.key === 'SEK')?.value || 0) / currencies.known : null;

  // Risk: Avanza's 1–7 for funds and ETFs (shares have none), plus how concentrated it is
  const rated = holdings.filter(h => h.isFund && isNum(h.details?.risk));
  const ratedValue = rated.reduce((acc, h) => acc + h.value, 0);
  const avgRisk = ratedValue > 0 ? rated.reduce((acc, h) => acc + h.value * h.details.risk, 0) / ratedValue : null;
  const riskLevels = spread(holdings, h => {
    if (!h.isFund) return [{ key: 'stock', label: 'Aktier (ingen risknivå)', weight: 1 }];
    const risk = h.details?.risk;
    return [isNum(risk) ? { key: `r${risk}`, label: `Risk ${risk} · ${RISK_TEXT[risk] || ''}`, weight: 1 } : { key: 'unknown', label: 'Okänd risk', weight: 1 }];
  });
  if (cash > 0) riskLevels.rows.push({ key: 'cash', label: 'Kontanter', value: cash });
  riskLevels.rows.sort((a, b) => a.key.localeCompare(b.key, 'sv', { numeric: true }));
  const byValue = [...holdings].sort((a, b) => b.value - a.value);
  const top5 = byValue.slice(0, 5).reduce((acc, h) => acc + h.value, 0);

  // Dividends over the last twelve months, against today's value
  const yearAgo = shiftMonths(today(), 12);
  const dividends12m = state.data.transactions
    .filter(t => t.type === 'dividend' && t.date > yearAgo && isNum(t.amount))
    .reduce((acc, t) => acc + t.amount, 0);

  const coveredByTop = funds.reduce((acc, h) => acc + h.value * Math.min(100, (h.details?.holdings || []).reduce((s, c) => s + c.weight, 0)) / 100, 0);

  const loading = state.detailsLoading ? el('p', { class: 'hint' }, 'Hämtar fonddata från Avanza…') : null;
  const top = companyRows[0];

  const kpis = el('section', { class: 'kpis analysis-kpis', 'aria-label': 'Insikter' },
    kpiTile({
      label: 'Fondavgifter per år',
      value: withFee.length ? kr(feePerYear) : '–',
      sub: withFee.length
        ? [`${fmt(feeBase > 0 ? (feePerYear / feeBase) * 100 : 0, 2)} % i snitt`, `≈ ${kr(feePerYear * 10)} på 10 år`, withFee.length < funds.length ? `avgift saknas för ${funds.length - withFee.length}` : null].filter(Boolean).join(' · ')
        : 'Inga fonder med känd avgift'
    }),
    kpiTile({
      label: 'I Sverige, genom fonderna',
      value: lookthrough.known > 0 ? share(sweden / lookthrough.known) : '–',
      sub: abroadTop ? `Störst utomlands: ${abroadTop.label} ${share(abroadTop.value / lookthrough.known)}` : null
    }),
    kpiTile({
      label: 'Utdelningar senaste 12 mån',
      value: kr(dividends12m),
      sub: invested > 0 ? `${fmt((dividends12m / invested) * 100, 2)} % av dagens värde` : null
    }),
    kpiTile({
      label: 'Största bolaget totalt',
      value: top ? top.name : '–',
      sub: top ? `${kr(top.value)} · ${share(top.value / invested)} av värdepapperen` : null
    })
  );

  const countryControls = el('div', { class: 'seg', role: 'group', 'aria-label': 'Hur länderna räknas' },
    [['lookthrough', 'Genom fonderna'], ['listing', 'Noteringsland']].map(([mode, label]) => el('button', {
      type: 'button',
      'aria-pressed': String(state.countryMode === mode),
      onclick: () => { state.countryMode = mode; savePref('countryMode', mode); renderAnalysis(); }
    }, label))
  );

  const companyTable = companyRows.length ? el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Bolag'), el('th', {}, 'Värde'), el('th', {}, 'Andel'))),
    el('tbody', {}, companyRows.slice(0, 15).map(c => el('tr', {},
      el('td', {}, el('strong', {}, c.name), el('span', { class: 'sub' },
        c.via.sort((a, b) => b.value - a.value).map(v => `${v.name} ${kr(v.value)}`).join(' · '))),
      el('td', { class: 'num' }, kr(c.value)),
      el('td', { class: 'num' }, share(c.value / invested))
    )))
  )) : el('p', { class: 'muted' }, 'Ingen data ännu.');

  const overlapBody = pairs.length ? el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Fonder'), el('th', {}, 'Överlapp'))),
    el('tbody', {}, pairs.slice(0, 8).map(p => el('tr', {},
      el('td', {}, el('strong', {}, `${p.a.name} + ${p.b.name}`), el('span', { class: 'sub' },
        `${p.common.length} gemensamma bolag, t.ex. ${p.common.slice(0, 3).map(c => c.name).join(', ')}`)),
      el('td', { class: 'num' }, `${fmt(p.overlap, 1)} %`)
    )))
  )) : el('p', { class: 'muted' }, funds.length > 1 ? 'Fonderna har inga gemensamma bolag bland sina största innehav.' : 'Behöver minst två fonder eller ETF:er.');

  const categoryNames = [...new Set(funds.map(h => h.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  const fundTable = funds.length ? el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Fond'), el('th', {}, 'Typ'), el('th', {}, 'Avgift %'), el('th', {}, 'Kr per år'), el('th', { class: 'col-opt' }, 'Risk'), el('th', { class: 'col-opt' }, 'Värde')
    )),
    el('tbody', {}, funds.map(h => {
      const avanzaCategory = h.details?.category || null;
      const category = el('input', {
        type: 'text', class: `cell-input${h.instrument.category ? ' overridden' : ''}`, list: 'category-list', value: h.category || '',
        placeholder: 'Välj typ', 'aria-label': `Typ för ${h.name}`,
        title: h.instrument.category ? `Ändrad av dig. Töm rutan för Avanzas kategori${avanzaCategory ? ` (${avanzaCategory})` : ''}.` : 'Avanzas kategori',
        onchange: e => {
          const value = e.target.value.trim();
          saveInstrumentField(h.id, 'category', value && value !== avanzaCategory ? value : null);
        },
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }
      });
      const fee = el('input', {
        type: 'text', inputmode: 'decimal', class: `cell-input fee-input${isNum(h.instrument.fee) ? ' overridden' : ''}`, value: numInput(h.fee),
        placeholder: '–', 'aria-label': `Avgift i procent för ${h.name}`,
        title: isNum(h.instrument.fee) ? `Ändrad av dig. Töm rutan för Avanzas avgift${isNum(h.avanzaFee) ? ` (${numInput(h.avanzaFee)} %)` : ''}.` : 'Årlig avgift enligt Avanza',
        onchange: e => {
          const text = e.target.value.trim();
          const value = parseNum(text);
          if (text && !(value >= 0)) { e.target.classList.add('invalid'); return; }
          saveInstrumentField(h.id, 'fee', text && value !== h.avanzaFee ? value : null);
        },
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }
      });
      const sub = [
        h.instrument.track ? `följer ${h.instrument.track.name}` : null,
        h.details?.fundType && h.details.fundType !== h.category ? h.details.fundType : null,
        h.instrument.kind === 'etf' && !isNum(h.fee) ? 'ange avgiften själv, Avanza visar den inte' : null
      ].filter(Boolean).join(' · ');
      return el('tr', {},
        el('td', {}, el('strong', {}, h.name), sub ? el('span', { class: 'sub' }, sub) : null),
        el('td', {}, category),
        el('td', { class: 'num' }, fee),
        el('td', { class: 'num' }, isNum(h.fee) ? kr(h.value * h.fee / 100) : '–'),
        el('td', { class: 'num col-opt' }, isNum(h.details?.risk) ? `${h.details.risk} av 7` : '–'),
        el('td', { class: 'num col-opt' }, kr(h.value))
      );
    }))
  )) : el('p', { class: 'muted' }, 'Inga fonder eller ETF:er.');

  container.replaceChildren(...[loading].filter(Boolean),
    kpis,
    el('div', { class: 'analysis-grid analysis' },
      analysisCard('Tillgångsslag', [
        barList(classes.rows, invested + cash),
        el('p', { class: 'note' }, `Totalt ${kr(invested + cash)}. Ett eget innehav som följer en fond räknas som fond.`)
      ]),
      analysisCard('Fondtyper', [
        barList(categories.rows, fundValue),
        el('p', { class: 'note' }, 'Enligt Avanzas kategori. Du kan ändra typen i tabellen längst ner.')
      ]),
      analysisCard('Länder', [
        barList(countries.rows, countries.known, 12),
        unknownNote(countries.unknown, 'landsdata'),
        el('p', { class: 'note' }, state.countryMode === 'listing'
          ? 'Aktier räknas på bolagets land, fonder och ETF:er på sin kategori.'
          : 'Fonder och ETF:er fördelas på länderna de äger aktier i, enligt Avanzas senaste fonddata. Kontanter räknas inte.')
      ], { controls: countryControls }),
      analysisCard('Sektorer', [
        barList(sectors.rows, sectors.known, 12),
        unknownNote(sectors.unknown, 'sektordata'),
        el('p', { class: 'note' }, 'Fonder och ETF:er fördelas efter sina sektorvikter, aktier på bolagets sektor.')
      ]),
      analysisCard('Valuta', [
        barList(currencies.rows, currencies.known),
        unknownNote(currencies.unknown, 'valutadata'),
        el('p', { class: 'note' }, `${share(foreignCurrency)} är exponerat mot andra valutor än kronor. Räknat på vilka länders aktier du äger, även genom fonder i kronor, eftersom de följer valutan. Valutasäkrade fonder syns inte. Kontanter räknas som kronor.`)
      ]),
      analysisCard('Risk', [
        el('div', { class: 'stats' },
          el('div', {}, el('span', { class: 'kpi-label' }, 'Fondernas risk, viktad'), el('strong', {}, isNum(avgRisk) ? `${fmt(avgRisk, 1)} av 7` : '–')),
          el('div', {}, el('span', { class: 'kpi-label' }, 'Största innehavet'), el('strong', {}, byValue[0] ? share(byValue[0].value / invested) : '–')),
          el('div', {}, el('span', { class: 'kpi-label' }, 'Fem största'), el('strong', {}, share(top5 / invested)))
        ),
        barList(riskLevels.rows, invested + cash),
        el('p', { class: 'note' }, `Avanzas risknivå 1–7 för fonder och ETF:er, viktad på värdet. Aktier har ingen risknivå. Största innehavet är ${byValue[0]?.name || '–'}. Största och fem största räknas på värdepapperen, utan kontanter.`)
      ]),
      analysisCard('Underliggande bolag', [
        companyTable,
        el('p', { class: 'note' }, fundValue > 0
          ? `Aktier du äger direkt plus de ca 25 största innehaven i varje fond, som täcker ${share(coveredByTop / fundValue)} av fondernas värde. Resten är spritt på mindre innehav.`
          : 'Aktier du äger direkt.')
      ]),
      analysisCard('Överlapp mellan fonder', [
        overlapBody,
        el('p', { class: 'note' }, 'Hur stor del av fonderna som ligger i samma bolag, räknat på de största innehaven. Högt överlapp betyder att fonderna sprider risken mindre än det ser ut.')
      ]),
      dividendsCard(),
      analysisCard('Fonder: typ och avgift', [
        fundTable,
        el('datalist', { id: 'category-list' }, [...new Set([...categoryNames, 'Global', 'Sverige', 'Norden', 'Europa', 'Nordamerika', 'Tillväxtmarknader', 'Räntefond', 'Blandfond'])].map(n => el('option', { value: n }))),
        el('p', { class: 'note' }, 'Typ och avgift kommer från Avanza. Ändra en ruta för att sätta ett eget värde, töm den för att gå tillbaka till Avanzas.')
      ], { wide: true })
    )
  );
}

// --- Graph ---

function renderRangeControls() {
  $('range').replaceChildren(...RANGES.map(r => el('button', {
    type: 'button',
    'aria-pressed': String(r.key === state.range),
    onclick: () => { state.range = r.key; savePref('range', r.key); renderRangeControls(); loadChart(); }
  }, r.label)));
  document.querySelectorAll('#mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
}

function setMode(mode) {
  state.mode = mode;
  savePref('mode', mode);
  renderRangeControls();
  loadChart();
}

function niceTicks(min, max, count) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rough);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) {
    ticks.push(Math.round(v / step) * step);
    if (ticks.at(-1) >= max) break;
  }
  return ticks;
}

function renderChart() {
  const container = $('chart');
  // Hidden behind the analysis tab it has no size; setView draws it when it's shown again
  if (!container.clientWidth) return;
  const series = state.mode === 'actual'
    ? [{ key: 'value', label: 'Värde', color: 'var(--series-1)' }, { key: 'invested', label: 'Anskaffningsvärde', color: 'var(--series-2)' }]
    : [{ key: 'value', label: 'Dagens innehav, värderat bakåt i tiden', color: 'var(--series-1)' }];
  $('legend').replaceChildren(...series.map(s => el('span', {}, el('i', { style: `background:${s.color}` }), s.label)));

  const points = buildChartSeries();
  const hint = $('chart-hint');
  hint.hidden = true;
  container.replaceChildren();
  renderChartTable(points, series);

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (points.length < 2) {
    const message = !state.data.transactions.length ? 'Lägg till innehav för att se grafen.' : 'Grafen fylls på allt eftersom.';
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': message });
    const text = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'empty' });
    text.textContent = message;
    svg.append(text);
    container.append(svg);
    if (state.mode === 'actual' && state.data.transactions.length) {
      hint.replaceChildren(
        `Grafen visar portföljens värde från din första affär (${formatDate(firstTradeDate() || today())}). `,
        el('button', { type: 'button', class: 'btn small', onclick: () => setMode('current') }, 'Visa hur dagens innehav har gått')
      );
      hint.hidden = false;
    }
    return;
  }

  const pad = { top: 10, right: 10, bottom: 26, left: 48 };
  const values = points.flatMap(p => series.map(s => p[s.key])).filter(isNum);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const y0 = ticks[0];
  const y1 = ticks.at(-1);
  const t0 = parseDate(points[0].date).getTime();
  const t1 = parseDate(points.at(-1).date).getTime();
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xs = points.map(p => pad.left + ((parseDate(p.date).getTime() - t0) / (t1 - t0 || 1)) * plotW);
  const y = v => pad.top + (1 - (v - y0) / (y1 - y0 || 1)) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Graf: ${series.map(s => s.label).join(' och ')}` });

  const grid = svgEl('g', { class: 'grid' });
  for (const tick of ticks) {
    const ty = Math.round(y(tick)) + 0.5;
    if (tick !== y0) grid.append(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: ty, y2: ty }));
    const label = svgEl('text', { x: pad.left - 8, y: ty + 4, 'text-anchor': 'end', class: 'tick' });
    label.textContent = compact(tick);
    svg.append(label);
  }
  svg.append(grid);
  svg.append(svgEl('line', { class: 'baseline', x1: pad.left, x2: width - pad.right, y1: Math.round(y(y0)) + 0.5, y2: Math.round(y(y0)) + 0.5 }));

  // Date labels along the bottom
  const spanDays = (t1 - t0) / 86400000;
  const labelFormat = spanDays > 400 ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' };
  const labelCount = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
  for (let i = 0; i < labelCount; i++) {
    const t = t0 + ((t1 - t0) * i) / (labelCount - 1);
    const label = svgEl('text', {
      x: pad.left + (plotW * i) / (labelCount - 1),
      y: height - 6,
      'text-anchor': i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle',
      class: 'tick'
    });
    label.textContent = new Date(t).toLocaleDateString('sv-SE', labelFormat);
    svg.append(label);
  }

  const linePath = key => points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const valuePath = linePath('value');
  svg.append(svgEl('path', {
    d: `${valuePath}L${xs.at(-1).toFixed(1)},${y(y0).toFixed(1)}L${xs[0].toFixed(1)},${y(y0).toFixed(1)}Z`,
    fill: 'var(--series-1)',
    'fill-opacity': 0.1
  }));
  // Draw the reference line first, so the value line sits on top
  for (const s of [...series].reverse()) {
    svg.append(svgEl('path', { class: 'line', d: s.key === 'value' ? valuePath : linePath(s.key), stroke: s.color }));
  }

  // Hover / keyboard layer
  const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH, visibility: 'hidden' });
  const dots = series.map(s => svgEl('circle', { class: 'dot', r: 4, fill: s.color, visibility: 'hidden' }));
  const overlay = svgEl('rect', { class: 'overlay', x: pad.left, y: 0, width: plotW, height, tabindex: 0, 'aria-label': 'Flytta med piltangenterna för att se värden' });
  svg.append(crosshair, ...dots, overlay);
  container.append(svg);

  const tooltip = el('div', { class: 'tooltip', hidden: true });
  container.append(tooltip);
  let active = points.length - 1;

  const show = index => {
    active = Math.max(0, Math.min(points.length - 1, index));
    const p = points[active];
    const x = xs[active];
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('visibility', 'visible');
    series.forEach((s, i) => {
      dots[i].setAttribute('cx', x);
      dots[i].setAttribute('cy', y(p[s.key]));
      dots[i].setAttribute('visibility', 'visible');
    });
    const rows = series.map(s => el('div', { class: 'tt-row' }, el('i', { style: `background:${s.color}` }), el('strong', {}, kr(p[s.key])), el('span', {}, s.key === 'value' ? 'Värde' : s.label)));
    if (state.mode === 'actual') {
      const gain = p.value - p.invested;
      rows.push(el('div', { class: 'tt-row' }, el('i', {}), el('strong', { class: dirClass(gain) }, signedKr(gain)), el('span', {}, 'Orealiserat')));
    }
    tooltip.replaceChildren(el('div', { class: 'tt-date' }, formatDate(p.date)), ...rows);
    tooltip.hidden = false;
    const tipWidth = tooltip.offsetWidth;
    tooltip.style.left = `${x + 12 + tipWidth > width ? Math.max(0, x - 12 - tipWidth) : x + 12}px`;
  };
  const hide = () => {
    tooltip.hidden = true;
    crosshair.setAttribute('visibility', 'hidden');
    dots.forEach(d => d.setAttribute('visibility', 'hidden'));
  };
  const nearest = clientX => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  };
  overlay.addEventListener('pointermove', e => show(nearest(e.clientX)));
  overlay.addEventListener('pointerdown', e => show(nearest(e.clientX)));
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('focus', () => show(active));
  overlay.addEventListener('blur', hide);
  overlay.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(active - step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(active + step); }
  });
}

function renderChartTable(points, series) {
  if (points.length < 2) {
    $('chart-table').replaceChildren(el('p', { class: 'muted' }, 'Ingen historik ännu.'));
    return;
  }
  // About 24 evenly spread rows, always including the first and the latest
  const step = Math.max(1, Math.ceil(points.length / 24));
  const rows = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  $('chart-table').replaceChildren(el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Datum'), ...series.map(s => el('th', {}, s.key === 'value' ? 'Värde' : s.label)))),
    el('tbody', {}, rows.map(p => el('tr', {}, el('td', { class: 'num' }, p.date), ...series.map(s => el('td', { class: 'num' }, kr(p[s.key]))))))
  )));
}

// --- Transaction dialog ---

const dialog = { type: 'buy', instrument: null, editing: null, fxTouched: false, openingTouched: false, prefilledPrice: '', searchSeq: 0, fxSeq: 0 };

function platformNames() {
  const used = [...state.data.transactions, ...state.data.cash].map(t => t.platform);
  return [...new Set([...DEFAULT_PLATFORMS, ...used].filter(Boolean))];
}

function openTxDialog({ type = 'buy', instrumentId = null, platform = '', tx = null } = {}) {
  $('tx-form').reset();
  dialog.editing = tx;
  dialog.fxTouched = !!tx;
  dialog.openingTouched = !!tx;
  dialog.prefilledPrice = '';
  $('tx-opening').checked = !!tx?.opening;
  $('tx-title').textContent = tx ? 'Ändra affär' : 'Ny affär';
  $('tx-delete').hidden = !tx;
  $('tx-error').textContent = '';
  $('tx-date').value = tx?.date || today();
  $('tx-platform').value = tx?.platform || platform || pref('platform', DEFAULT_PLATFORMS[0]);
  $('platform-list').replaceChildren(...platformNames().map(name => el('option', { value: name })));
  setTxType(tx?.type || type);

  if (tx) {
    $('tx-quantity').value = numInput(tx.quantity);
    $('tx-price').value = numInput(tx.price);
    $('tx-fx').value = numInput(tx.fxRate);
    $('tx-fee').value = tx.fee ? numInput(tx.fee) : '';
    $('tx-amount').value = numInput(tx.amount);
    $('tx-note').value = tx.note || '';
  }
  const id = tx?.instrumentId || instrumentId;
  setInstrument(id ? { ...state.data.instruments[id], id } : null, { prefill: !tx });

  $('tx-dialog').showModal();
  if (!dialog.instrument) $('instrument-search').focus();
  else if (!tx) (dialog.type === 'dividend' ? $('tx-amount') : $('tx-quantity')).focus();
}

function setTxType(type) {
  dialog.type = type;
  $('tx-form').dataset.txType = type;
  document.querySelectorAll('#tx-type button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
  updateHeldNote();
  updateTxSummary();
}

// New holdings start out as "starting position", since that is what you enter first; a buy of
// something you already have on that platform is most likely a new purchase
function updateOpeningDefault() {
  if (!dialog.openingTouched) {
    const meta = dialog.instrument;
    const platform = $('tx-platform').value.trim();
    $('tx-opening').checked = !meta?.id || !platform || heldQuantity(meta.id, platform) === 0;
  }
  const opening = dialog.type === 'buy' && $('tx-opening').checked;
  $('price-label').textContent = opening ? 'GAV' : 'Kurs';
  // Today's price is a good guess for a new trade, but never for your own GAV
  const priceInput = $('tx-price');
  if (dialog.prefilledPrice) {
    if (opening && priceInput.value === dialog.prefilledPrice) priceInput.value = '';
    else if (!opening && !priceInput.value) priceInput.value = dialog.prefilledPrice;
  }
}

function setInstrument(meta, { prefill = true } = {}) {
  dialog.instrument = meta;
  $('instrument-picked').hidden = !meta;
  $('instrument-search-wrap').hidden = !!meta;
  if (!meta) {
    if ($('tx-price').value === dialog.prefilledPrice) $('tx-price').value = '';
    dialog.prefilledPrice = '';
    $('instrument-search').value = '';
    $('instrument-results').replaceChildren();
    updateCurrencyFields('SEK');
    updateHeldNote();
    updateTxSummary();
    return;
  }
  $('picked-name').textContent = meta.name;
  $('picked-meta').textContent = [KIND_LABEL[meta.kind], meta.market, meta.currency].filter(Boolean).join(' · ');
  updateCurrencyFields(meta.currency || 'SEK');
  dialog.prefilledPrice = '';
  if (prefill && !$('tx-price').value && $('tx-date').value >= today()) {
    const q = meta.id ? quoteFor(meta.id) : null;
    const latest = q?.price ?? meta.price;
    if (isNum(latest)) $('tx-price').value = dialog.prefilledPrice = numInput(round(latest, 4));
  }
  updateHeldNote();
  updateTxSummary();
}

function updateCurrencyFields(currency) {
  $('price-currency').textContent = currency;
  $('fx-label').textContent = `SEK/${currency}`;
  $('fx-field').hidden = currency === 'SEK';
  if (currency !== 'SEK') prefillFx();
}

async function prefillFx() {
  const currency = dialog.instrument?.currency;
  if (!currency || currency === 'SEK' || dialog.fxTouched) return;
  const date = $('tx-date').value || today();
  const seq = ++dialog.fxSeq;
  let rate = null;
  try {
    if (date >= today()) {
      rate = state.fx[currency]?.rate ?? (await api(`/api/quotes?fx=${currency}`)).fx[currency]?.rate;
    } else {
      const data = await api(`/api/history?period=${periodCovering(daysBetween(date, today()))}&fx=${currency}`);
      const points = (data.fx[currency] || []).map(([ts, r]) => [tsToDate(ts), r]).sort(byDate);
      rate = stepper(points)(date) ?? points[0]?.[1];
    }
  } catch {
    // The field stays empty and the user fills it in
  }
  if (seq !== dialog.fxSeq || dialog.fxTouched || !isNum(rate)) return;
  $('tx-fx').value = numInput(round(rate, 4));
  updateTxSummary();
}

function heldQuantity(instrumentId, platform) {
  const others = state.data.transactions.filter(t => t.id !== dialog.editing?.id);
  const position = newPosition(instrumentId, platform);
  for (const t of sortedTransactions(others)) {
    if (t.instrumentId === instrumentId && t.platform === platform) applyTransaction(position, t, today());
  }
  return position.qty;
}

function updateHeldNote() {
  updateOpeningDefault();
  const note = $('held-note');
  note.replaceChildren();
  const meta = dialog.instrument;
  const platform = $('tx-platform').value.trim();
  if (!meta?.id || !platform || dialog.type === 'dividend') return;
  const held = heldQuantity(meta.id, platform);
  if (dialog.type === 'sell') {
    note.append(held > 0
      ? el('button', { type: 'button', class: 'btn small ghost', onclick: () => { $('tx-quantity').value = numInput(round(held, 6)); updateTxSummary(); } }, `Du äger ${quantity(held)} st här – sälj alla`)
      : `Du äger inga på ${platform}.`);
  } else if (held > 0) {
    note.append(`Du äger ${quantity(held)} st här sedan tidigare.`);
  }
}

function readTxForm() {
  return {
    quantity: parseNum($('tx-quantity').value),
    price: parseNum($('tx-price').value),
    fxRate: dialog.instrument?.currency && dialog.instrument.currency !== 'SEK' ? parseNum($('tx-fx').value) : 1,
    fee: $('tx-fee').value.trim() ? parseNum($('tx-fee').value) : 0,
    amount: parseNum($('tx-amount').value)
  };
}

function updateTxSummary() {
  const summary = $('tx-summary');
  const f = readTxForm();
  const meta = dialog.instrument;
  if (dialog.type === 'dividend' || !meta || !(f.quantity > 0) || !(f.price >= 0) || !(f.fxRate > 0)) {
    summary.textContent = '';
    return;
  }
  const gross = f.quantity * f.price * f.fxRate;
  if (dialog.type === 'buy') {
    summary.textContent = `Totalt ${kr(gross + (f.fee || 0), 2)}${f.fee ? ' inkl. courtage' : ''}`;
  } else {
    const proceeds = gross - (f.fee || 0);
    let text = `Du får ${kr(proceeds, 2)}`;
    const platform = $('tx-platform').value.trim();
    if (meta.id && platform) {
      const position = newPosition(meta.id, platform);
      const others = state.data.transactions.filter(t => t.id !== dialog.editing?.id && t.instrumentId === meta.id && t.platform === platform);
      for (const t of sortedTransactions(others)) applyTransaction(position, t, today());
      if (position.qty > 0) {
        const gain = proceeds - position.cost * (Math.min(f.quantity, position.qty) / position.qty);
        text += ` · vinst ${signedKr(gain)}`;
      }
    }
    summary.textContent = text;
  }
}

let searchTimer = null;

async function runSearch() {
  const query = $('instrument-search').value.trim();
  const seq = ++dialog.searchSeq;
  const owned = Object.entries(state.data.instruments)
    .map(([id, instrument]) => ({ ...instrument, id }))
    .filter(i => !query || i.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);
  let results = [];
  let error = '';
  if (query.length >= 2) {
    try {
      results = (await api(`/api/search?q=${encodeURIComponent(query)}`)).results;
    } catch (err) {
      error = err.message;
    }
  }
  if (seq !== dialog.searchSeq) return;

  const ownedIds = new Set(owned.map(i => i.id));
  const items = [];
  const option = (meta, metaText, priceText) => el('li', {}, el('button', { type: 'button', role: 'option', onclick: () => setInstrument(meta) },
    el('span', {}, el('span', { class: 'r-name' }, meta.name), el('span', { class: 'r-meta' }, metaText)),
    priceText ? el('span', { class: 'r-price' }, priceText) : null
  ));

  if (owned.length) {
    items.push(el('li', { class: 'r-group' }, 'Dina innehav'));
    owned.forEach(i => items.push(option(i, [KIND_LABEL[i.kind], i.currency].filter(Boolean).join(' · '))));
  }
  const fresh = results.filter(r => !ownedIds.has(r.id));
  if (fresh.length) {
    items.push(el('li', { class: 'r-group' }, 'Från Avanza'));
    fresh.forEach(r => items.push(option(r, [KIND_LABEL[r.kind], r.market].filter(Boolean).join(' · '), isNum(r.price) ? `${price(r.price)} ${r.currency}` : '')));
  }
  if (error) items.push(el('li', { class: 'r-group' }, error));
  if (query.length >= 2) {
    items.push(el('li', {}, el('button', { type: 'button', onclick: () => setInstrument({ id: null, kind: 'manual', name: query, currency: 'SEK' }) },
      el('span', {}, el('span', { class: 'r-name' }, `+ Lägg till ”${query}” som eget innehav`),
        el('span', { class: 'r-meta' }, 'För sådant som inte finns på Avanza. Du uppdaterar kursen själv.'))
    )));
  }
  $('instrument-results').replaceChildren(...items);
}

function validateTx() {
  const f = readTxForm();
  const meta = dialog.instrument;
  const platform = $('tx-platform').value.trim();
  const date = $('tx-date').value;
  if (!meta) return 'Välj ett värdepapper.';
  if (!platform) return 'Ange plattform.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Ange datum.';
  if (dialog.type === 'dividend') {
    if (!(f.amount > 0)) return 'Ange beloppet du fick.';
    return null;
  }
  if (!(f.quantity > 0)) return 'Ange antal.';
  if (!(f.price >= 0)) return 'Ange kurs.';
  if (!(f.fxRate > 0)) return 'Ange växelkurs.';
  if (!(f.fee >= 0)) return 'Courtage måste vara ett tal.';
  if (dialog.type === 'sell') {
    const held = meta.id ? heldQuantity(meta.id, platform) : 0;
    if (f.quantity > held + 1e-6) return `Du äger bara ${quantity(held)} st på ${platform}.`;
  }
  return null;
}

async function saveTx(event) {
  event.preventDefault();
  const error = validateTx();
  $('tx-error').textContent = error || '';
  if (error) return;

  const f = readTxForm();
  const meta = { ...dialog.instrument };
  if (!meta.id) meta.id = `manual:${crypto.randomUUID()}`;
  const editing = dialog.editing;
  const tx = {
    id: editing?.id || crypto.randomUUID(),
    createdAt: editing?.createdAt || Date.now(),
    type: dialog.type,
    date: $('tx-date').value,
    instrumentId: meta.id,
    platform: $('tx-platform').value.trim(),
    note: $('tx-note').value.trim() || undefined,
    opening: dialog.type === 'buy' && $('tx-opening').checked ? true : undefined
  };
  if (tx.type === 'dividend') {
    tx.amount = f.amount;
  } else {
    Object.assign(tx, { quantity: f.quantity, price: f.price, fxRate: f.fxRate, fee: f.fee || 0 });
  }

  $('tx-save').disabled = true;
  try {
    await mutate(data => {
      if (!data.instruments[meta.id]) {
        data.instruments[meta.id] = { kind: meta.kind, name: meta.name, currency: meta.currency || 'SEK', ...(meta.market ? { market: meta.market } : {}) };
      }
      const instrument = data.instruments[meta.id];
      // An own holding gets its price from what you paid, until you set a new one
      if (instrument.kind === 'manual' && tx.type !== 'dividend' && !(instrument.prices || []).some(p => p.date >= tx.date)) {
        instrument.prices = [...(instrument.prices || []), { date: tx.date, price: tx.price }];
      }
      const index = data.transactions.findIndex(t => t.id === tx.id);
      if (index >= 0) data.transactions[index] = tx;
      else data.transactions.push(tx);
      removeUnusedInstruments(data);
    });
    savePref('platform', tx.platform);
    state.expanded.add(meta.id);
    $('tx-dialog').close();
  } catch (err) {
    $('tx-error').textContent = `Kunde inte spara: ${err.message}`;
  } finally {
    $('tx-save').disabled = false;
  }
}

function removeUnusedInstruments(data) {
  const used = new Set(data.transactions.map(t => t.instrumentId));
  Object.keys(data.instruments).forEach(id => { if (!used.has(id)) delete data.instruments[id]; });
}

async function deleteTx() {
  const tx = dialog.editing;
  if (!tx || !confirm(`Ta bort ${typeLabel(tx).toLowerCase()} av ${instrumentName(tx.instrumentId)} (${tx.date})?`)) return;
  try {
    await mutate(data => {
      data.transactions = data.transactions.filter(t => t.id !== tx.id);
      removeUnusedInstruments(data);
    });
    $('tx-dialog').close();
  } catch (err) {
    $('tx-error').textContent = `Kunde inte ta bort: ${err.message}`;
  }
}

// --- Banner, export & import ---

function showBanner(text, actionLabel, action) {
  $('banner-text').textContent = text;
  const button = $('banner-action');
  button.hidden = !actionLabel;
  button.textContent = actionLabel || '';
  button.onclick = action || null;
  $('banner').hidden = false;
}

function hideBanner() {
  $('banner').hidden = true;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const link = el('a', { href: URL.createObjectURL(blob), download: `portfolj-${today()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importJson(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported.instruments !== 'object' || !Array.isArray(imported.transactions)) {
      throw new Error('Filen ser inte ut som en export från den här sidan.');
    }
    if (!confirm(`Ersätta hela portföljen med filens ${imported.transactions.length} affärer?`)) return;
    await mutate(data => {
      data.instruments = imported.instruments;
      data.transactions = imported.transactions;
      data.cash = Array.isArray(imported.cash) ? imported.cash : [];
    });
  } catch (err) {
    showBanner(`Importen misslyckades: ${err.message}`);
  }
}

// --- Start ---

function wireEvents() {
  $('new-tx').addEventListener('click', () => openTxDialog());
  $('refresh').addEventListener('click', () => { state.details = {}; refreshQuotes(); state.history = {}; loadChart(); });
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#view-tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('#list-tabs button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll('#list-tabs button').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    $('holdings').hidden = state.tab !== 'holdings';
    $('transactions').hidden = state.tab !== 'transactions';
    $('closed-toggle').style.visibility = state.tab === 'holdings' ? '' : 'hidden';
  }));
  $('show-closed').addEventListener('change', e => { state.showClosed = e.target.checked; render(); });
  $('export').addEventListener('click', exportJson);
  $('import').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });

  // Dialog
  $('tx-form').addEventListener('submit', saveTx);
  $('tx-delete').addEventListener('click', deleteTx);
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $('tx-dialog').close()));
  document.querySelectorAll('#tx-type button').forEach(b => b.addEventListener('click', () => setTxType(b.dataset.type)));
  $('picked-change').addEventListener('click', () => { setInstrument(null); $('instrument-search').focus(); runSearch(); });
  $('instrument-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  $('instrument-search').addEventListener('focus', () => { if (!$('instrument-results').children.length) runSearch(); });
  $('instrument-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('instrument-results').querySelector('button')?.click();
    }
  });
  $('tx-platform').addEventListener('input', () => { updateHeldNote(); updateTxSummary(); });
  $('tx-date').addEventListener('change', () => { if (!dialog.fxTouched) prefillFx(); });
  $('tx-fx').addEventListener('input', () => { dialog.fxTouched = true; });
  $('tx-opening').addEventListener('change', () => { dialog.openingTouched = true; updateOpeningDefault(); });
  ['tx-quantity', 'tx-price', 'tx-fx', 'tx-fee'].forEach(id => $(id).addEventListener('input', updateTxSummary));

  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderChart);
  }).observe($('chart'));

  setInterval(() => { if (document.visibilityState === 'visible') refreshQuotes(); }, QUOTE_REFRESH_MS);
  setInterval(() => { if (document.visibilityState === 'visible') { state.history = {}; loadChart(); } }, HISTORY_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.quotesAt > QUOTE_REFRESH_MS) refreshQuotes();
  });
}

async function init() {
  wireEvents();
  renderRangeControls();
  setView(state.view);
  try {
    const { data, version, email } = await api('/api/portfolio');
    state.data = normalize(data);
    state.version = version;
    state.email = email || '';
  } catch (err) {
    $('status').textContent = '';
    if (err.status !== 401) showBanner(err.message, 'Försök igen', () => location.reload());
    return;
  }
  render();
  await refreshQuotes();
  await loadChart();
}

init();
