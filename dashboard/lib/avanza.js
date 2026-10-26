// Prices from Avanza's public (unofficial) web API: stocks, ETFs, funds and exchange rates.
// No API key needed. Stock quotes are delayed about 15 minutes, funds have one price (NAV) a day.
//
// Instrument ids used by the dashboard: "avanza:<kind>:<orderbookId>", kind = stock | etf | fund

const BASE = 'https://www.avanza.se/_api';

const SEARCH_TYPES = { STOCK: 'stock', EXCHANGE_TRADED_FUND: 'etf', FUND: 'fund' };

// Orderbooks for exchange rates against SEK; other currencies are looked up by search
const FX_ORDERBOOKS = {
  USD: '19000', EUR: '18998', NOK: '53293', DKK: '53292',
  GBP: '108703', CAD: '108701', CHF: '108704', JPY: '108702'
};

// Edge cache in front of Avanza, so reloading the page doesn't hit Avanza every time
async function cachedJson(cacheKey, ttlSeconds, fetchUpstream) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const keyRequest = new Request(`https://www.avanza.se/_cache/${cacheKey}`);
  if (cache) {
    const hit = await cache.match(keyRequest).catch(() => null);
    if (hit) return hit.json();
  }
  const response = await fetchUpstream();
  if (!response.ok) throw new Error(`Avanza HTTP ${response.status} (${cacheKey})`);
  const data = await response.json();
  if (cache) {
    await cache.put(keyRequest, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
    })).catch(() => {});
  }
  return data;
}

function getJson(path, ttlSeconds) {
  return cachedJson(path, ttlSeconds, () => fetch(`${BASE}/${path}`, {
    headers: { 'Accept': 'application/json' }
  }));
}

function postSearch(query, types, size) {
  const key = `search/${types.join(',')}/${size}/${encodeURIComponent(query.toLowerCase())}`;
  return cachedJson(key, 3600, () => fetch(`${BASE}/search/filtered-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, searchFilter: { types }, pagination: { from: 0, size } })
  }));
}

// Avanza writes prices like "1 234,56"
function parseSwedishNumber(text) {
  if (text == null) return null;
  const n = parseFloat(String(text).replace(/[\s ]/g, '').replace('−', '-').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseInstrumentId(id) {
  const match = /^avanza:(stock|etf|fund):(\d+)$/.exec(id || '');
  return match ? { kind: match[1], orderbookId: match[2] } : null;
}

export async function search(query) {
  const data = await postSearch(query, Object.keys(SEARCH_TYPES), 10);
  return (data.hits || []).map(hit => ({
    id: `avanza:${SEARCH_TYPES[hit.type]}:${hit.orderBookId}`,
    kind: SEARCH_TYPES[hit.type],
    name: hit.title,
    market: hit.marketPlaceName || '',
    flag: hit.flagCode || '',
    price: parseSwedishNumber(hit.price?.last),
    currency: hit.price?.currency || 'SEK'
  })).filter(hit => hit.kind);
}

function stockLikeQuote(data) {
  const q = data.quote || {};
  const last = q.last ?? data.historicalClosingPrices?.oneDay ?? null;
  const prevClose = data.historicalClosingPrices?.oneDay ?? (last != null && q.change != null ? last - q.change : last);
  return {
    name: data.name,
    ticker: data.listing?.tickerSymbol || '',
    currency: data.listing?.currency || 'SEK',
    price: last,
    prevClose,
    time: q.timeOfLast || q.updated || null,
    realTime: !!q.isRealTime
  };
}

export async function quote(id) {
  const parsed = parseInstrumentId(id);
  if (!parsed) throw new Error(`Okänt värdepapper: ${id}`);
  const { kind, orderbookId } = parsed;

  if (kind === 'fund') {
    const data = await getJson(`fund-guide/guide/${orderbookId}`, 600);
    const dayChange = data.developmentOneDay;
    return {
      name: data.name,
      ticker: '',
      currency: data.currency || 'SEK',
      price: data.nav,
      prevClose: dayChange != null ? data.nav / (1 + dayChange / 100) : data.nav,
      time: data.navDate ? Date.parse(`${data.navDate.slice(0, 10)}T00:00:00Z`) : null,
      realTime: false
    };
  }
  const data = await getJson(kind === 'etf' ? `market-etf/${orderbookId}` : `market-guide/stock/${orderbookId}`, 30);
  return stockLikeQuote(data);
}

async function fxOrderbook(currency) {
  if (FX_ORDERBOOKS[currency]) return FX_ORDERBOOKS[currency];
  const data = await postSearch(`${currency}/SEK`, ['INDEX'], 5);
  const hit = (data.hits || []).find(h => h.title?.toUpperCase().startsWith(`${currency}/SEK`));
  if (!hit) throw new Error(`Hittar ingen växelkurs för ${currency}`);
  return hit.orderBookId;
}

// SEK per unit of the currency: { rate, prevClose }
export async function fxQuote(currency) {
  if (currency === 'SEK') return { rate: 1, prevClose: 1 };
  const data = await getJson(`market-index/${await fxOrderbook(currency)}`, 60);
  const rate = data.quote?.last ?? data.historicalClosingPrices?.oneDay;
  return { rate, prevClose: data.historicalClosingPrices?.oneDay ?? rate };
}

export const PERIODS = ['one_month', 'three_months', 'this_year', 'one_year', 'three_years', 'five_years', 'infinity'];

function stockChartPath(orderbookId, period) {
  const resolution = period === 'infinity' ? 'week' : 'day';
  return `price-chart/stock/${orderbookId}?timePeriod=${period}&resolution=${resolution}`;
}

// Daily (weekly for long periods) closing prices: [[timestamp, close], ...]
export async function history(id, period) {
  const parsed = parseInstrumentId(id);
  if (!parsed) throw new Error(`Okänt värdepapper: ${id}`);
  if (parsed.kind === 'fund') {
    const data = await getJson(`fund-guide/chart/${parsed.orderbookId}/${period}?raw=true`, 3600);
    return (data.dataSerie || []).filter(p => p.y != null).map(p => [p.x, p.y]);
  }
  const data = await getJson(stockChartPath(parsed.orderbookId, period), 3600);
  return (data.ohlc || []).map(p => [p.timestamp, p.close]);
}

export async function fxHistory(currency, period) {
  const data = await getJson(stockChartPath(await fxOrderbook(currency), period), 3600);
  return (data.ohlc || []).map(p => [p.timestamp, p.close]);
}
