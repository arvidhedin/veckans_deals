/**
 * Veckans Deals - Frontend Application Logic
 * Clean, modern Scandinavian UI with responsive mobile drawer and live filtering.
 */

// Clean up any previously cached dark theme
if (document.documentElement.classList.contains('dark')) {
  document.documentElement.classList.remove('dark');
}
localStorage.removeItem('theme');

// Global State
const state = {
  allOffers: [],
  filteredOffers: [],
  willysAssortment: [],
  sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
  selectedStores: new Set([
    // ICA
    'ICA Nära Råbyvägen',
    'ICA Supermarket Torgkassen',
    'ICA Nära Rosendal',
    'ICA Supermarket Väst',
    'ICA Vretgränd',
    'ICA Supermarket City',
    'ICA Supermarket Luthagens Livs',
    'ICA Folkes Livs',
    'ICA Nära Hörnan',
    // Willys
    'Willys',
    'Willys (Björkgatan)',
    // Hemköp
    'Hemköp',
    'Hemköp (Svava)',
    'Hemköp (Rosendal)',
    // Coop
    'Coop',
    'Coop (Centralhuset)',
    'Coop (Liljegatan)',
    // Lidl
    'Lidl'
  ]),
  lidlPeriod: 'all', // 'all' | 'this-week' | 'next-week'
  searchQuery: '',
  sortBy: 'discount-desc',
  storeCounts: {}
};

// Store color configuration
const STORE_COLORS = {
  // ICA Stores (#E21936)
  'ICA Nära Råbyvägen': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Supermarket Torgkassen': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Nära Rosendal': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Supermarket Väst': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Vretgränd': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Supermarket City': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Supermarket Luthagens Livs': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Folkes Livs': { bg: '#E21936', text: '#FFFFFF' },
  'ICA Nära Hörnan': { bg: '#E21936', text: '#FFFFFF' },

  // Willys (#009345)
  'Willys': { bg: '#009345', text: '#FFFFFF' },
  'Willys (Björkgatan)': { bg: '#009345', text: '#FFFFFF' },

  // Hemköp (#D31115)
  'Hemköp': { bg: '#D31115', text: '#FFFFFF' },
  'Hemköp (Svava)': { bg: '#D31115', text: '#FFFFFF' },
  'Hemköp (Rosendal)': { bg: '#D31115', text: '#FFFFFF' },

  // Coop (#007A33)
  'Coop': { bg: '#007A33', text: '#FFFFFF' },
  'Coop (Centralhuset)': { bg: '#007A33', text: '#FFFFFF' },
  'Coop (Liljegatan)': { bg: '#007A33', text: '#FFFFFF' },

  // Lidl (#00509E)
  'Lidl': { bg: '#00509E', text: '#FFFFFF' }
};

const DEFAULT_IMG = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80";

// --- Data Fetching ---
async function fetchDealsData() {
  const statusEl = document.getElementById('status-update-text');
  try {
    const response = await fetch(`deals.json?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Kunde inte ladda deals.json (HTTP ${response.status})`);
    }

    const data = await response.json();
    
    if (Array.isArray(data)) {
      state.allOffers = data;
    } else {
      state.allOffers = data.offers || [];
      state.willysAssortment = data.willys_assortment || [];
      if (data.updated_at_readable && statusEl) {
        statusEl.textContent = `Uppdaterad: ${data.updated_at_readable}`;
      } else if (statusEl) {
        statusEl.textContent = `${state.allOffers.length} erbjudanden laddade`;
      }
    }

    computeStoreCounts();
    applyFilters();
  } catch (error) {
    console.error('Fel vid hämtning av erbjudanden:', error);
    if (statusEl) {
      statusEl.textContent = 'Kunde inte hämta erbjudanden';
    }
    renderErrorState(error.message);
  }
}

// --- Statistics & Store Counts ---
function computeStoreCounts() {
  state.storeCounts = {};
  for (const offer of state.allOffers) {
    const store = (offer.store || '').trim();
    if (store) {
      state.storeCounts[store] = (state.storeCounts[store] || 0) + 1;
    }
  }

  // Helper to find count by exact name, aliases, or case-insensitive match
  const getCount = (name, aliases = []) => {
    if (state.storeCounts[name] !== undefined) return state.storeCounts[name];
    for (const alias of aliases) {
      if (state.storeCounts[alias] !== undefined) return state.storeCounts[alias];
    }
    const lowerName = name.toLowerCase();
    for (const [key, count] of Object.entries(state.storeCounts)) {
      if (key.toLowerCase() === lowerName) return count;
    }
    return 0;
  };

  // ICA
  updateCountElement('count-ica-raby', getCount('ICA Nära Råbyvägen'));
  updateCountElement('count-ica-torg', getCount('ICA Supermarket Torgkassen'));
  updateCountElement('count-ica-rosendal', getCount('ICA Nära Rosendal'));
  updateCountElement('count-ica-vast', getCount('ICA Supermarket Väst'));
  updateCountElement('count-ica-vretgrand', getCount('ICA Vretgränd'));
  updateCountElement('count-ica-city', getCount('ICA Supermarket City'));
  updateCountElement('count-ica-luthagen', getCount('ICA Supermarket Luthagens Livs'));
  updateCountElement('count-ica-folkes', getCount('ICA Folkes Livs'));
  updateCountElement('count-ica-hornan', getCount('ICA Nära Hörnan'));

  // Willys
  updateCountElement('count-willys', getCount('Willys', ['Willys (Björkgatan)']));

  // Hemköp
  updateCountElement('count-hemkop-svava', getCount('Hemköp (Svava)', ['Hemköp']));
  updateCountElement('count-hemkop-rosendal', getCount('Hemköp (Rosendal)'));

  // Coop
  updateCountElement('count-coop-centralhuset', getCount('Coop (Centralhuset)', ['Coop']));
  updateCountElement('count-coop-liljegatan', getCount('Coop (Liljegatan)'));

  // Lidl
  updateCountElement('count-lidl', getCount('Lidl'));

  updateMobileFilterBadge();
}

function updateCountElement(id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count;
}

function updateMobileFilterBadge() {
  const badge = document.getElementById('mobile-filter-badge');
  const mobileCount = document.getElementById('mobile-filter-count');
  const checkboxes = document.querySelectorAll('.store-filter:checked');
  const count = checkboxes.length;
  if (badge) badge.textContent = count;
  if (mobileCount) mobileCount.textContent = `${count} valda`;
}

// --- Lidl Date Filtering Logic ---
function parseLidlDates(restrictionStr, today) {
  if (!restrictionStr) return [];
  const regex = /(\d{1,2})\/(\d{1,2})/g;
  const matches = [...restrictionStr.matchAll(regex)];
  const parsed = [];
  
  for (const match of matches) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed month
    let year = today.getFullYear();

    if (today.getMonth() === 11 && month === 0) {
      year += 1;
    } else if (today.getMonth() === 0 && month === 11) {
      year -= 1;
    }

    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) {
      parsed.push(d);
    }
  }
  return parsed;
}

function filterLidlOffers(lidlOffers, period) {
  if (period === 'all') {
    return lidlOffers;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const dayOfWeek = (today.getDay() + 6) % 7; // Monday is 0, Sunday is 6
  const startOfThisWeek = new Date(today);
  startOfThisWeek.setDate(today.getDate() - dayOfWeek);

  const endOfThisWeek = new Date(startOfThisWeek);
  endOfThisWeek.setDate(startOfThisWeek.getDate() + 6);

  const startOfNextWeek = new Date(startOfThisWeek);
  startOfNextWeek.setDate(startOfThisWeek.getDate() + 7);

  const endOfNextWeek = new Date(startOfNextWeek);
  endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);

  const filtered = [];

  for (const offer of lidlOffers) {
    const restriction = offer.restriction || '';
    const parsedDates = parseLidlDates(restriction, today);

    if (parsedDates.length === 0) {
      filtered.push(offer);
      continue;
    }

    const d1 = parsedDates[0];
    const d2 = parsedDates.length > 1 ? parsedDates[1] : d1;

    if (period === 'this-week') {
      if (Math.max(d1.getTime(), startOfThisWeek.getTime()) <= Math.min(d2.getTime(), endOfThisWeek.getTime())) {
        filtered.push(offer);
      }
    } else if (period === 'next-week') {
      if (Math.max(d1.getTime(), startOfNextWeek.getTime()) <= Math.min(d2.getTime(), endOfNextWeek.getTime())) {
        filtered.push(offer);
      }
    }
  }

  return filtered;
}

// --- Filtering & Sorting Core ---
function applyFilters() {
  let result = [];

  // 1. Filter by selected store
  for (const offer of state.allOffers) {
    const store = (offer.store || '').trim();
    if (store === 'Lidl') {
      continue;
    }

    if (state.selectedStores.has(store)) {
      result.push(offer);
    }
  }

  // 2. Lidl Store & Date Filtering
  if (state.selectedStores.has('Lidl')) {
    const lidlOffers = state.allOffers.filter(o => o.store === 'Lidl');
    const filteredLidl = filterLidlOffers(lidlOffers, state.lidlPeriod);
    result.push(...filteredLidl);
  }

  // 3. Search Query Filter
  const rawQ = state.searchQuery.trim();
  const q = rawQ.toLowerCase();

  if (q) {
    const queryTokens = q.split(/\s+/).filter(Boolean);

    result = result.filter(offer => {
      const product = (offer.product || '').toLowerCase();
      const brand = (offer.brand || '').toLowerCase();
      const desc = (offer.description || '').toLowerCase();
      const combined = `${product} ${brand} ${desc}`;
      
      if (combined.includes(q)) return true;
      return queryTokens.every(token => combined.includes(token));
    });
  }

  // 4. Sorting
  sortOffers(result, state.sortBy);

  state.filteredOffers = result;

  // 5. Render UI
  renderDeals();
  renderResultsCount();
  updateMobileFilterBadge();

  // 6. Fetch & Render Willys Reference Prices
  updateWillysReferenceBox(q);
}

function parsePriceNumeric(priceStr) {
  if (!priceStr) return 0;
  const clean = String(priceStr).replace(/\s+/g, '').replace(',', '.');
  const match = clean.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function sortOffers(offers, sortBy) {
  offers.sort((a, b) => {
    if (sortBy === 'discount-desc') {
      const pctA = parseFloat(a.discount_percentage) || 0;
      const pctB = parseFloat(b.discount_percentage) || 0;
      return pctB - pctA;
    }
    if (sortBy === 'price-asc') {
      return parsePriceNumeric(a.price) - parsePriceNumeric(b.price);
    }
    if (sortBy === 'price-desc') {
      return parsePriceNumeric(b.price) - parsePriceNumeric(a.price);
    }
    if (sortBy === 'name-asc') {
      return (a.product || '').localeCompare(b.product || '', 'sv');
    }
    if (sortBy === 'store-asc') {
      return (a.store || '').localeCompare(b.store || '', 'sv');
    }
    return 0;
  });
}

// --- Willys Reference Box Logic (Live API + Local Fallback) ---
const willysSearchCache = new Map();
let currentWillysSearchToken = 0;

function getLocalWillysMatches(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const queryTokens = q.split(/\s+/).filter(Boolean);

  const pool = [
    ...state.allOffers.filter(o => (o.store || '').toLowerCase().includes('willys')),
    ...state.willysAssortment
  ];

  const scoredMatches = [];
  const seenKeys = new Set();

  for (const item of pool) {
    const prod = (item.product || '').toLowerCase();
    const brand = (item.brand || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const fullText = `${prod} ${brand} ${desc}`;

    let score = 0;
    if (prod === q) {
      score = 10;
    } else if (prod.startsWith(q)) {
      score = 8;
    } else if (prod.includes(q)) {
      score = 6;
    } else if (fullText.includes(q)) {
      score = 4;
    } else if (queryTokens.length > 0 && queryTokens.every(t => fullText.includes(t))) {
      score = 3;
    } else if (queryTokens.some(t => t.length >= 3 && (prod.includes(t) || fullText.includes(t)))) {
      score = 1;
    }

    if (score > 0) {
      const key = `${(item.product || '').trim()}_${(item.brand || '').trim()}`.toLowerCase();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        scoredMatches.push({ item, score });
      }
    }
  }

  scoredMatches.sort((a, b) => b.score - a.score);
  return scoredMatches.map(m => m.item).slice(0, 5);
}

async function fetchWillysReferenceItems(query) {
  if (!query || query.trim().length < 2) return [];
  
  const q = query.trim().toLowerCase();
  if (willysSearchCache.has(q)) {
    return willysSearchCache.get(q);
  }

  try {
    const url = `https://www.willys.se/axfood/rest/v1/search?q=${encodeURIComponent(q)}&page=0&size=6`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    const mapped = results.map(item => {
      const priceVal = String(item.price || '').replace('kr', '').trim();
      const priceStr = priceVal ? `${priceVal} kr` : '';

      const compPrice = String(item.comparePrice || '').replace('kr', '').replace('.', ',').trim();
      const compUnit = item.comparePriceUnit || '';
      const displayVol = item.displayVolume || '';
      
      const descParts = [];
      if (displayVol) descParts.push(displayVol);
      if (compPrice && compUnit) descParts.push(`Jmf: ${compPrice} kr/${compUnit}`);
      else if (compPrice) descParts.push(`Jmf: ${compPrice} kr`);

      let imgUrl = '';
      if (item.image && item.image.url) {
        const u = item.image.url;
        imgUrl = u.startsWith('http') 
          ? u 
          : `https://assets.axfood.se/image/upload/f_auto,t_200/${u.replace(/^\//, '')}`;
      }

      return {
        product: item.name || 'Okänd produkt',
        brand: item.manufacturer || '',
        price: priceStr,
        description: descParts.join(' | '),
        image_url: imgUrl
      };
    });

    willysSearchCache.set(q, mapped);
    return mapped;
  } catch (err) {
    console.warn('Direct Willys API search failed, falling back to local dataset:', err);
    return [];
  }
}

async function updateWillysReferenceBox(query) {
  const token = ++currentWillysSearchToken;
  const box = document.getElementById('willys-reference-box');
  const container = document.getElementById('willys-reference-items');
  if (!box || !container) return;

  const q = (query || '').trim();

  if (!q || q.length < 2) {
    box.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  // 1. Immediate local feedback from dataset if available
  const localMatches = getLocalWillysMatches(q);
  if (localMatches.length > 0) {
    renderReferenceBox(localMatches, q);
  }

  // 2. Fetch live items from Willys regular assortment API
  try {
    const apiMatches = await fetchWillysReferenceItems(q);
    if (token !== currentWillysSearchToken) return;

    if (apiMatches && apiMatches.length > 0) {
      renderReferenceBox(apiMatches, q);
    } else if (localMatches.length > 0) {
      renderReferenceBox(localMatches, q);
    } else {
      box.classList.add('hidden');
      container.innerHTML = '';
    }
  } catch (e) {
    if (token === currentWillysSearchToken) {
      if (localMatches.length > 0) {
        renderReferenceBox(localMatches, q);
      } else {
        box.classList.add('hidden');
        container.innerHTML = '';
      }
    }
  }
}

function renderReferenceBox(matches, query) {
  const box = document.getElementById('willys-reference-box');
  const container = document.getElementById('willys-reference-items');
  if (!box || !container) return;

  if (!query || !matches || matches.length === 0) {
    box.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (const ref of matches) {
    const name = escapeHtml(ref.product || 'Okänd produkt');
    const brand = ref.brand ? `<span class="text-emerald-800 font-medium text-xs">(${escapeHtml(ref.brand)})</span>` : '';
    const desc = ref.description ? `<span class="text-emerald-700/80 text-xs font-normal">· ${escapeHtml(ref.description)}</span>` : '';
    const price = escapeHtml(ref.price || ref.original_price || '');
    const imgHtml = ref.image_url 
      ? `<img src="${ref.image_url}" alt="${name}" class="w-7 h-7 sm:w-8 sm:h-8 object-contain rounded bg-white p-0.5 border border-emerald-200/80 flex-shrink-0" onerror="this.style.display='none'">` 
      : '';

    html += `
      <div class="flex items-center justify-between gap-3 text-xs sm:text-sm py-2 border-b border-emerald-200/70 last:border-0 text-emerald-950">
        <div class="flex items-center gap-2.5 min-w-0 truncate">
          ${imgHtml}
          <div class="truncate font-bold text-emerald-950">
            <span>${name}</span>
            ${brand}
            ${desc}
          </div>
        </div>
        <span class="font-extrabold text-emerald-900 whitespace-nowrap text-xs sm:text-sm ml-2 bg-emerald-100/90 px-2 py-0.5 rounded-lg border border-emerald-200">${price}</span>
      </div>
    `;
  }

  container.innerHTML = html;
  box.classList.remove('hidden');
}

// Store shortener for card badges
function getShortStoreName(store) {
  if (!store) return '';
  const s = store.trim();

  const exactMap = {
    'ICA Supermarket Torgkassen': 'ICA Torgkassen',
    'ICA Supermarket Luthagens Livs': 'ICA Luthagens Livs',
    'ICA Supermarket Väst': 'ICA Väst',
    'ICA Supermarket City': 'ICA City',
    'ICA Nära Råbyvägen': 'ICA Råbyvägen',
    'ICA Nära Rosendal': 'ICA Rosendal',
    'ICA Nära Hörnan': 'ICA Hörnan',
    'ICA Folkes Livs': 'ICA Folkes',
    'ICA Vretgränd': 'ICA Vretgränd',
    'Hemköp (Svava)': 'Hemköp Svava',
    'Hemköp (Rosendal)': 'Hemköp Rosendal',
    'Coop (Centralhuset)': 'Coop Centralhuset',
    'Coop (Liljegatan)': 'Coop Liljegatan',
    'Willys (Björkgatan)': 'Willys',
  };

  if (exactMap[s]) {
    return exactMap[s];
  }

  let cleaned = s
    .replace(/^ICA\s+(Supermarket|Nära|Kvantum|Maxi)\s+/i, 'ICA ')
    .replace(/\s*\((.*?)\)/g, ' $1');

  return cleaned.trim();
}

// --- Deal Card Template Generator ---
function createDealCardHtml(offer) {
  const store = (offer.store || 'Okänd butik').trim();
  const shortStore = getShortStoreName(store);
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('ica') ? '#E21936' : (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563'));
  
  const discountPct = parseFloat(offer.discount_percentage) || 0;
  const pctBadgeHtml = discountPct > 0 
    ? `<span class="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 bg-rose-600 text-white font-extrabold text-[8px] sm:text-[10px] md:text-[11px] px-1 sm:px-2 py-0.5 rounded shadow-sm z-10 tracking-wider">-${Math.round(discountPct)}%</span>` 
    : '';

  const imgUrl = offer.image_url || DEFAULT_IMG;
  const brandTag = offer.brand ? escapeHtml(offer.brand) : '&nbsp;';
  const descTag = offer.description ? escapeHtml(offer.description) : '&nbsp;';
  const productName = escapeHtml(offer.product || 'Okänd produkt');
  const priceStr = escapeHtml(offer.price || 'Se pris i butik');
  
  const origPriceHtml = offer.original_price 
    ? `<div class="text-[9px] sm:text-xs line-through text-zinc-400 font-medium leading-none">${escapeHtml(offer.original_price)}</div>` 
    : '';

  const discountTagHtml = offer.discount 
    ? `<div class="text-[8px] sm:text-[10px] md:text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200/60 px-1 sm:px-2 py-0.5 rounded w-fit mt-1 truncate max-w-full">${escapeHtml(offer.discount)}</div>` 
    : '';

  // Restriction badge (e.g. Endast Tor-Sön)
  const restriction = (offer.restriction || '').toLowerCase();
  const isTorSon = restriction.includes('tor') || restriction.includes('sön') || restriction.includes('son');
  const restrictionBadgeHtml = isTorSon 
    ? `<div class="text-[8px] sm:text-[10px] md:text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-1 sm:px-2 py-0.5 rounded w-fit mt-1 truncate max-w-full">Endast Tor-Sön</div>`
    : (offer.restriction ? `<div class="text-[8px] sm:text-[10px] md:text-[11px] font-medium text-amber-600 mt-1 truncate">${escapeHtml(offer.restriction)}</div>` : '');

  return `
    <div class="deal-card group bg-white rounded-xl sm:rounded-2xl border border-zinc-200/80 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 flex flex-col h-[280px] sm:h-[350px] md:h-[390px] relative overflow-hidden">
      <!-- Store Badge Overlay -->
      <span class="absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 px-1.5 py-0.5 sm:px-2 sm:py-0.75 rounded text-[7.5px] leading-[1.1] sm:text-[10px] md:text-[11px] font-bold tracking-wide uppercase text-white shadow-sm z-10 max-w-[calc(100%-42px)] sm:max-w-none line-clamp-2 break-words text-left" style="background-color: ${storeBadgeColor};" title="${escapeHtml(store)}">
        ${escapeHtml(shortStore)}
      </span>

      <!-- Discount Percentage Badge -->
      ${pctBadgeHtml}

      <!-- Image Container -->
      <div class="h-24 sm:h-36 md:h-44 bg-zinc-50/70 flex items-center justify-center p-2 sm:p-3 relative overflow-hidden border-b border-zinc-100">
        <img 
          src="${imgUrl}" 
          alt="${productName}"
          loading="lazy"
          onerror="this.onerror=null; this.src='${DEFAULT_IMG}';"
          class="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
        />
      </div>

      <!-- Card Body -->
      <div class="p-2 sm:p-3 md:p-4 flex flex-col flex-grow justify-between">
        <div>
          <span class="text-[9px] sm:text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-zinc-400 block truncate">
            ${brandTag}
          </span>
          <h3 class="text-xs sm:text-sm md:text-base font-bold text-zinc-900 line-clamp-2 leading-tight mt-0.5" title="${productName}">
            ${productName}
          </h3>
          <p class="text-[9px] sm:text-xs text-zinc-500 mt-0.5 truncate hidden sm:block">
            ${descTag}
          </p>
        </div>

        <div class="pt-1 sm:pt-2">
          ${origPriceHtml}
          <div class="text-xs sm:text-base md:text-xl font-black text-rose-600 tracking-tight leading-none mt-0.5">
            ${priceStr}
          </div>
          ${discountTagHtml}
          ${restrictionBadgeHtml}
        </div>
      </div>
    </div>
  `;
}

// --- Deals Grid Rendering ---
function renderDeals() {
  const grid = document.getElementById('deals-grid');
  const emptyState = document.getElementById('empty-state');
  if (!grid || !emptyState) return;

  if (state.filteredOffers.length === 0) {
    grid.innerHTML = '';
    const descEl = emptyState.querySelector('p');
    if (descEl) {
      if (state.searchQuery) {
        descEl.innerHTML = `Det fanns inga rabatterade veckodeals för "<strong>${escapeHtml(state.searchQuery)}</strong>" den här veckan, men du kan se Willys ordinarie referenspriser ovan ⬆️`;
      } else {
        descEl.textContent = 'Det fanns inga erbjudanden som matchade dina valda butiksfilter.';
      }
    }
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = state.filteredOffers.map(createDealCardHtml).join('');
}

function renderResultsCount() {
  const countEl = document.getElementById('results-count');
  if (countEl) {
    countEl.innerHTML = `Visar <strong class="text-zinc-900 font-bold">${state.filteredOffers.length}</strong> aktuella erbjudanden`;
  }
}

function renderErrorState(message) {
  const grid = document.getElementById('deals-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="col-span-full bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-700">
        <div class="text-3xl mb-2">⚠️</div>
        <h3 class="font-bold text-base mb-1">Kunde inte ladda erbjudanden</h3>
        <p class="text-sm opacity-80 mb-4">${escapeHtml(message)}</p>
        <button onclick="fetchDealsData()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition shadow">
          Försök igen
        </button>
      </div>
    `;
  }
}

// --- Mobile Filter Drawer Handlers ---
function openMobileFilterDrawer() {
  const sidebar = document.getElementById('filter-sidebar');
  const backdrop = document.getElementById('filter-backdrop');
  if (sidebar && backdrop) {
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth;
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    
    sidebar.classList.remove('translate-x-full');
    sidebar.classList.add('translate-x-0');
    document.body.classList.add('overflow-hidden', 'lg:overflow-auto');
  }
}

function closeMobileFilterDrawer() {
  const sidebar = document.getElementById('filter-sidebar');
  const backdrop = document.getElementById('filter-backdrop');
  if (sidebar && backdrop) {
    sidebar.classList.remove('translate-x-0');
    sidebar.classList.add('translate-x-full');
    
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    setTimeout(() => {
      backdrop.classList.add('hidden');
    }, 300);
    document.body.classList.remove('overflow-hidden', 'lg:overflow-auto');
  }
}

// --- Desktop Sidebar Collapse/Expand Handler ---
function toggleDesktopSidebar(forceState) {
  const sidebar = document.getElementById('filter-sidebar');
  const btnToggle = document.getElementById('btn-toggle-sidebar-desktop');
  if (!sidebar) return;

  if (typeof forceState === 'boolean') {
    state.sidebarCollapsed = forceState;
  } else {
    state.sidebarCollapsed = !state.sidebarCollapsed;
  }

  localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed);

  if (state.sidebarCollapsed) {
    sidebar.classList.add('lg:hidden');
    if (btnToggle) {
      btnToggle.innerHTML = `
        <svg class="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path>
        </svg>
        <span>Visa filter</span>
      `;
    }
  } else {
    sidebar.classList.remove('lg:hidden');
    if (btnToggle) {
      btnToggle.innerHTML = `
        <svg class="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
        </svg>
        <span>Dölj filter</span>
      `;
    }
  }
}

// --- Helper Functions ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Desktop Sidebar Toggle & Collapse Buttons
  const btnToggleDesktop = document.getElementById('btn-toggle-sidebar-desktop');
  const btnCollapseDesktop = document.getElementById('btn-collapse-sidebar-desktop');

  if (btnToggleDesktop) btnToggleDesktop.addEventListener('click', () => toggleDesktopSidebar());
  if (btnCollapseDesktop) btnCollapseDesktop.addEventListener('click', () => toggleDesktopSidebar(true));

  // Initialize desktop sidebar state
  toggleDesktopSidebar(state.sidebarCollapsed);

  // Mobile Drawer Toggle Buttons
  const btnOpenDrawer = document.getElementById('btn-open-filter-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-filter-drawer');
  const btnApplyMobile = document.getElementById('btn-apply-filter-mobile');
  const backdrop = document.getElementById('filter-backdrop');

  if (btnOpenDrawer) btnOpenDrawer.addEventListener('click', openMobileFilterDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeMobileFilterDrawer);
  if (btnApplyMobile) btnApplyMobile.addEventListener('click', closeMobileFilterDrawer);
  if (backdrop) backdrop.addEventListener('click', closeMobileFilterDrawer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileFilterDrawer();
  });

  // Store filter checkboxes
  const checkboxes = document.querySelectorAll('.store-filter');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const storeName = e.target.dataset.store;
      if (e.target.checked) {
        state.selectedStores.add(storeName);
        if (storeName === 'Hemköp (Svava)') state.selectedStores.add('Hemköp');
        if (storeName === 'Coop (Centralhuset)') state.selectedStores.add('Coop');
        if (storeName === 'Willys') state.selectedStores.add('Willys (Björkgatan)');
      } else {
        state.selectedStores.delete(storeName);
        if (storeName === 'Hemköp (Svava)') state.selectedStores.delete('Hemköp');
        if (storeName === 'Coop (Centralhuset)') state.selectedStores.delete('Coop');
        if (storeName === 'Willys') state.selectedStores.delete('Willys (Björkgatan)');
      }
      
      // Toggle Lidl period filter visibility
      const lidlSection = document.getElementById('lidl-filter-section');
      if (lidlSection) {
        if (state.selectedStores.has('Lidl')) {
          lidlSection.classList.remove('opacity-40', 'pointer-events-none');
        } else {
          lidlSection.classList.add('opacity-40', 'pointer-events-none');
        }
      }

      applyFilters();
    });
  });

  // Lidl Period Radios
  const lidlRadios = document.querySelectorAll('input[name="lidl-period"]');
  lidlRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.lidlPeriod = e.target.value;
        applyFilters();
      }
    });
  });

  // Select All Stores Button
  const btnSelectAll = document.getElementById('btn-select-all');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      checkboxes.forEach(cb => {
        cb.checked = true;
        state.selectedStores.add(cb.dataset.store);
      });
      state.selectedStores.add('Hemköp');
      state.selectedStores.add('Coop');
      state.selectedStores.add('Willys (Björkgatan)');
      applyFilters();
    });
  }

  // Deselect All Stores Button
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      checkboxes.forEach(cb => {
        cb.checked = false;
      });
      state.selectedStores.clear();
      applyFilters();
    });
  }

  // Search Input with Debounce & Clear Button
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  let debounceTimeout = null;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (btnClearSearch) {
        if (val) {
          btnClearSearch.classList.remove('hidden');
        } else {
          btnClearSearch.classList.add('hidden');
        }
      }

      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        state.searchQuery = val;
        applyFilters();
      }, 150);
    });
  }

  if (btnClearSearch && searchInput) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      btnClearSearch.classList.add('hidden');
      state.searchQuery = '';
      applyFilters();
      searchInput.focus();
    });
  }

  // Sort Dropdown
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFilters();
    });
  }

  // Reset Filters Button (on empty state)
  const btnReset = document.getElementById('btn-reset-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      checkboxes.forEach(cb => {
        cb.checked = true;
        state.selectedStores.add(cb.dataset.store);
      });
      if (searchInput) {
        searchInput.value = '';
        if (btnClearSearch) btnClearSearch.classList.add('hidden');
      }
      state.searchQuery = '';
      state.lidlPeriod = 'all';
      const defaultRadio = document.querySelector('input[name="lidl-period"][value="all"]');
      if (defaultRadio) defaultRadio.checked = true;
      if (sortSelect) sortSelect.value = 'discount-desc';
      state.sortBy = 'discount-desc';
      applyFilters();
    });
  }
}

// --- Initialization on DOM Load ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchDealsData();
});
