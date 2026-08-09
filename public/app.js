/**
 * Veckans Deals - Frontend Application Logic
 * Replicates Streamlit UI & functionality in client-side JavaScript.
 */

// Global State
const state = {
  allOffers: [],
  filteredOffers: [],
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
  'ICA Nära Råbyvägen': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Supermarket Torgkassen': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Nära Rosendal': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Supermarket Väst': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Vretgränd': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Supermarket City': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Supermarket Luthagens Livs': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Folkes Livs': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },
  'ICA Nära Hörnan': { bg: '#E21936', text: '#FFFFFF', pillClass: 'bg-red-600' },

  // Willys (#009345)
  'Willys': { bg: '#009345', text: '#FFFFFF', pillClass: 'bg-green-600' },
  'Willys (Björkgatan)': { bg: '#009345', text: '#FFFFFF', pillClass: 'bg-green-600' },

  // Hemköp (#D31115)
  'Hemköp': { bg: '#D31115', text: '#FFFFFF', pillClass: 'bg-red-700' },
  'Hemköp (Svava)': { bg: '#D31115', text: '#FFFFFF', pillClass: 'bg-red-700' },
  'Hemköp (Rosendal)': { bg: '#D31115', text: '#FFFFFF', pillClass: 'bg-red-700' },

  // Coop (#007A33)
  'Coop': { bg: '#007A33', text: '#FFFFFF', pillClass: 'bg-emerald-700' },
  'Coop (Centralhuset)': { bg: '#007A33', text: '#FFFFFF', pillClass: 'bg-emerald-700' },
  'Coop (Liljegatan)': { bg: '#007A33', text: '#FFFFFF', pillClass: 'bg-emerald-700' },

  // Lidl (#00509E)
  'Lidl': { bg: '#00509E', text: '#FFFFFF', pillClass: 'bg-blue-600' }
};

const DEFAULT_IMG = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80";

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  updateThemeButton();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeButton();
}

function updateThemeButton() {
  const isDark = document.documentElement.classList.contains('dark');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (label) label.textContent = isDark ? 'Ljust läge' : 'Mörkt läge';
}

// --- Data Fetching ---
async function fetchDealsData() {
  const statusEl = document.getElementById('status-update-text');
  try {
    const response = await fetch(`deals.json?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Kunde inte ladda deals.json (HTTP ${response.status})`);
    }

    const data = await response.json();
    
    // Support both raw list and envelope with metadata
    if (Array.isArray(data)) {
      state.allOffers = data;
    } else {
      state.allOffers = data.offers || [];
      if (data.updated_at_readable && statusEl) {
        statusEl.textContent = `Senast uppdaterad: ${data.updated_at_readable}`;
      } else if (statusEl) {
        statusEl.textContent = `Uppdaterad (${state.allOffers.length} erbjudanden)`;
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

// --- Statistics & Counts ---
function computeStoreCounts() {
  state.storeCounts = {};
  for (const offer of state.allOffers) {
    const store = offer.store || 'Okänd';
    state.storeCounts[store] = (state.storeCounts[store] || 0) + 1;
  }

  // Update counts in sidebar
  // ICA
  updateCountElement('count-ica-raby', state.storeCounts['ICA Nära Råbyvägen'] || 0);
  updateCountElement('count-ica-torg', state.storeCounts['ICA Supermarket Torgkassen'] || 0);
  updateCountElement('count-ica-rosendal', state.storeCounts['ICA Nära Rosendal'] || 0);
  updateCountElement('count-ica-vast', state.storeCounts['ICA Supermarket Väst'] || 0);
  updateCountElement('count-ica-vretgrand', state.storeCounts['ICA Vretgränd'] || 0);
  updateCountElement('count-ica-city', state.storeCounts['ICA Supermarket City'] || 0);
  updateCountElement('count-ica-luthagen', state.storeCounts['ICA Supermarket Luthagens Livs'] || 0);
  updateCountElement('count-ica-folkes', state.storeCounts['ICA Folkes Livs'] || 0);
  updateCountElement('count-ica-hornan', state.storeCounts['ICA Nära Hörnan'] || 0);

  // Willys
  updateCountElement('count-willys', state.storeCounts['Willys'] || state.storeCounts['Willys (Björkgatan)'] || 0);

  // Hemköp
  updateCountElement('count-hemkop-svava', state.storeCounts['Hemköp (Svava)'] || state.storeCounts['Hemköp'] || 0);
  updateCountElement('count-hemkop-rosendal', state.storeCounts['Hemköp (Rosendal)'] || 0);

  // Coop
  updateCountElement('count-coop-centralhuset', state.storeCounts['Coop (Centralhuset)'] || state.storeCounts['Coop'] || 0);
  updateCountElement('count-coop-liljegatan', state.storeCounts['Coop (Liljegatan)'] || 0);

  // Lidl
  updateCountElement('count-lidl', state.storeCounts['Lidl'] || 0);
}

function updateCountElement(id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count;
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

    // Adjust for year rollover (e.g. current month Dec and deal in Jan)
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
  
  // Calculate Monday of current week
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

    // If no dates found in restriction, keep the offer
    if (parsedDates.length === 0) {
      filtered.push(offer);
      continue;
    }

    const d1 = parsedDates[0];
    const d2 = parsedDates.length > 1 ? parsedDates[1] : d1;

    if (period === 'this-week') {
      // Overlap check with this week
      if (Math.max(d1.getTime(), startOfThisWeek.getTime()) <= Math.min(d2.getTime(), endOfThisWeek.getTime())) {
        filtered.push(offer);
      }
    } else if (period === 'next-week') {
      // Overlap check with next week
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
    const store = offer.store || '';
    if (store === 'Lidl') {
      // Handle Lidl separately for date filtering
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
  const q = state.searchQuery.trim().toLowerCase();
  let willysReferenceMatches = [];

  if (q) {
    result = result.filter(offer => {
      const product = (offer.product || '').toLowerCase();
      const brand = (offer.brand || '').toLowerCase();
      const desc = (offer.description || '').toLowerCase();
      return product.includes(q) || brand.includes(q) || desc.includes(q);
    });

    // Extract Willys reference items from all Willys offers matching query
    willysReferenceMatches = state.allOffers.filter(o => {
      const isWillys = (o.store || '').toLowerCase().includes('willys');
      if (!isWillys) return false;
      const product = (o.product || '').toLowerCase();
      const brand = (o.brand || '').toLowerCase();
      return product.includes(q) || brand.includes(q);
    }).slice(0, 4);
  }

  // 4. Sorting
  sortOffers(result, state.sortBy);

  state.filteredOffers = result;

  // 5. Render UI
  renderReferenceBox(willysReferenceMatches, q);
  renderDeals();
  renderResultsCount();
}

function parsePriceNumeric(priceStr) {
  if (!priceStr) return 0;
  // Extract first number/float found in price string
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

// --- Willys Reference Box Rendering ---
function renderReferenceBox(matches, query) {
  const box = document.getElementById('willys-reference-box');
  const container = document.getElementById('willys-reference-items');
  if (!box || !container) return;

  if (!query || matches.length === 0) {
    box.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (const ref of matches) {
    const name = escapeHtml(ref.product || 'Okänd produkt');
    const brand = ref.brand ? ` <span class="opacity-70 font-normal text-xs">(${escapeHtml(ref.brand)})</span>` : '';
    const desc = ref.description ? ` <span class="opacity-60 text-xs">· ${escapeHtml(ref.description)}</span>` : '';
    const price = escapeHtml(ref.price || ref.original_price || '');

    html += `
      <div class="flex items-baseline justify-between gap-4 text-xs sm:text-sm py-1 border-b border-emerald-200/50 dark:border-emerald-800/30 last:border-0 text-emerald-950 dark:text-emerald-100">
        <div class="truncate">
          <span class="font-bold">${name}</span>
          ${brand}
          ${desc}
        </div>
        <span class="font-extrabold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">${price}</span>
      </div>
    `;
  }

  container.innerHTML = html;
  box.classList.remove('hidden');
}

// --- Deal Card Template Generator ---
function createDealCardHtml(offer) {
  const store = offer.store || 'Okänd butik';
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563');
  
  const discountPct = parseFloat(offer.discount_percentage) || 0;
  const pctBadgeHtml = discountPct > 0 
    ? `<span class="absolute top-3 right-3 bg-red-500 text-white font-extrabold text-xs px-2.5 py-1 rounded-full shadow-md z-10 tracking-wider">-${Math.round(discountPct)}%</span>` 
    : '';

  const imgUrl = offer.image_url || DEFAULT_IMG;
  const brandTag = offer.brand ? escapeHtml(offer.brand) : '&nbsp;';
  const descTag = offer.description ? escapeHtml(offer.description) : '&nbsp;';
  const productName = escapeHtml(offer.product || 'Okänd produkt');
  const priceStr = escapeHtml(offer.price || 'Se pris i butik');
  
  const origPriceHtml = offer.original_price 
    ? `<div class="text-xs line-through text-gray-400 dark:text-gray-500 font-medium mb-0.5">${escapeHtml(offer.original_price)}</div>` 
    : '';

  const discountTagHtml = offer.discount 
    ? `<div class="text-xs font-semibold bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 px-2 py-0.5 rounded w-fit mt-1">${escapeHtml(offer.discount)}</div>` 
    : '';

  // Restriction badge (e.g. Endast Tor-Sön)
  const restriction = (offer.restriction || '').toLowerCase();
  const isTorSon = restriction.includes('tor') || restriction.includes('sön') || restriction.includes('son');
  const restrictionBadgeHtml = isTorSon 
    ? `<div class="text-[11px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50 px-2 py-0.5 rounded w-fit mt-2">Endast Tor-Sön</div>`
    : (offer.restriction ? `<div class="text-[11px] font-medium text-amber-600 dark:text-amber-400 mt-1">${escapeHtml(offer.restriction)}</div>` : '');

  return `
    <div class="deal-card group bg-white dark:bg-darkcard rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 flex flex-col h-[420px] relative overflow-hidden">
      <!-- Store Badge Overlay -->
      <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-white shadow-md z-10" style="background-color: ${storeBadgeColor};">
        ${escapeHtml(store)}
      </span>

      <!-- Discount Percentage Badge -->
      ${pctBadgeHtml}

      <!-- Image Container -->
      <div class="h-44 bg-gray-50 dark:bg-darkimg flex items-center justify-center p-4 relative overflow-hidden border-b border-gray-100 dark:border-gray-800/80">
        <img 
          src="${imgUrl}" 
          alt="${productName}"
          loading="lazy"
          onerror="this.onerror=null; this.src='${DEFAULT_IMG}';"
          class="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      <!-- Card Body -->
      <div class="p-4 flex flex-col flex-grow justify-between">
        <div>
          <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block truncate">
            ${brandTag}
          </span>
          <h3 class="text-sm sm:text-base font-bold text-gray-900 dark:text-white line-clamp-2 leading-snug mt-0.5" title="${productName}">
            ${productName}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            ${descTag}
          </p>
        </div>

        <div class="pt-2">
          ${origPriceHtml}
          <div class="text-xl font-extrabold text-brand-deal tracking-tight">
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
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = state.filteredOffers.map(createDealCardHtml).join('');
}

function renderResultsCount() {
  const countEl = document.getElementById('results-count');
  if (countEl) {
    countEl.innerHTML = `Visar <strong class="text-gray-900 dark:text-white font-bold">${state.filteredOffers.length}</strong> aktuella erbjudanden`;
  }
}

function renderErrorState(message) {
  const grid = document.getElementById('deals-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="col-span-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center text-red-700 dark:text-red-300">
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
  // Theme Toggle Button
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

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
  initTheme();
  setupEventListeners();
  fetchDealsData();
});
