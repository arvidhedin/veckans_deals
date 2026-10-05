/**
 * Veckans Deals - Frontend Application Logic
 * Clean, modern Scandinavian UI with responsive mobile drawer and live filtering.
 */

// Clean up any previously cached dark theme
if (document.documentElement.classList.contains('dark')) {
  document.documentElement.classList.remove('dark');
}
localStorage.removeItem('theme');

// Standard Grocery Categories
const ALL_CATEGORIES = [
  'Kött & Fågel',
  'Chark & Pålägg',
  'Fisk & Skaldjur',
  'Mejeri & Ägg',
  'Frukt & Grönt',
  'Bröd & Bageri',
  'Skafferi',
  'Snacks & Godis',
  'Dryck',
  'Energidryck',
  'Frys & Färdigmat',
  'Hushåll & Hygien',
  'Övrigt'
];

// Global State
const state = {
  allOffers: [],
  filteredOffers: [],
  willysAssortment: [],
  cart: [],
  activeModalOffer: null,
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
    'Coop (Ekeby)',
    // Lidl
    'Lidl'
  ]),
  selectedCategories: new Set(ALL_CATEGORIES),
  activeCategoryPill: 'all', // 'all' or category string
  lidlPeriod: 'this-week', // 'all' | 'this-week' | 'next-week'
  searchQuery: '',
  sortBy: 'discount-desc',
  storeCounts: {},
  categoryCounts: {}
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
  'Coop (Ekeby)': { bg: '#007A33', text: '#FFFFFF' },

  // Lidl (#00509E)
  'Lidl': { bg: '#00509E', text: '#FFFFFF' }
};

const DEFAULT_IMG = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80";

// The category is set when deals.json is built (scrapers/categorizer.py)
function getCategory(offer) {
  return offer.category || 'Övrigt';
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
    
    if (Array.isArray(data)) {
      state.allOffers = data;
    } else {
      state.allOffers = data.offers || [];
      state.willysAssortment = data.willys_assortment || [];
      state.updatedAt = data.updated_at || null;
      if (data.updated_at_readable && statusEl) {
        statusEl.textContent = `Uppdaterad: ${data.updated_at_readable}`;
      } else if (statusEl) {
        statusEl.textContent = `${state.allOffers.length} erbjudanden laddade`;
      }
    }

    computeStoreCounts();
    computeCategoryCounts();
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
  updateCountElement('count-coop-ekeby', getCount('Coop (Ekeby)'));

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
  const storeCheckboxes = document.querySelectorAll('.store-filter:checked');
  const count = storeCheckboxes.length;
  if (badge) badge.textContent = count;
  if (mobileCount) mobileCount.textContent = `${count} valda butiker`;
}

// --- Helpers for Price & Weight Parsing ---
function extractPerUnitDealPriceJS(priceStr) {
  if (!priceStr) return { pricePerUnit: 0, isExplicitPerKg: false };

  const s = String(priceStr).toLowerCase().replace(/\s+/g, ' ').trim();
  const isExplicitPerKg = s.includes('/kg') || s.includes('kr/kg');

  // Match "X för Y" or "X st för Y" (fixing typo 'fölr')
  const xForY = s.match(/(\d+)\s*(?:st)?\s*f[öo]r\s*(\d+(?:[.,]\d+)?)/i);
  if (xForY) {
    const qty = parseFloat(xForY[1]);
    const total = parseFloat(xForY[2].replace(',', '.'));
    if (qty > 0 && total > 0) {
      return { pricePerUnit: total / qty, isExplicitPerKg };
    }
  }

  const cleanStr = s.replace(/.*f[öo]r\s*/i, '');
  const match = cleanStr.match(/(\d+(?:[.,]\d+)?)/);
  const val = match ? parseFloat(match[1].replace(',', '.')) : 0;

  return { pricePerUnit: val, isExplicitPerKg };
}

function extractPackageWeightInKgJS(text) {
  if (!text) return 0;
  const s = String(text).toLowerCase().replace(/\s+/g, ' ');

  // Gram range (e.g. 90-100g, 80-100 g)
  const mGramRange = s.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (mGramRange) {
    const g1 = parseFloat(mGramRange[1].replace(',', '.'));
    const g2 = parseFloat(mGramRange[2].replace(',', '.'));
    return ((g1 + g2) / 2.0) / 1000.0;
  }

  // Kg range (e.g. 1-1.5kg, 800g-1700g)
  const mKgRange = s.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (mKgRange) {
    const k1 = parseFloat(mKgRange[1].replace(',', '.'));
    const k2 = parseFloat(mKgRange[2].replace(',', '.'));
    return (k1 + k2) / 2.0;
  }

  // Single kg
  const mKg = s.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (mKg) {
    return parseFloat(mKg[1].replace(',', '.'));
  }

  // Single gram
  const mGram = s.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (mGram) {
    return parseFloat(mGram[1].replace(',', '.')) / 1000.0;
  }

  return 0;
}

// --- Shopping List (Inköpslista) & Savings Calculator Engine ---
const CART_STORAGE_KEY = 'veckans_deals_cart_v1';

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load cart from localStorage', e);
    return [];
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  } catch (e) {
    console.error('Failed to save cart to localStorage', e);
  }
}

function getMaxAllowedQty(offer) {
  if (!offer || !offer.restriction) return 99;
  const r = String(offer.restriction).toLowerCase();
  const m = r.match(/max\s*(\d+)/i);
  if (m) {
    const limit = parseInt(m[1], 10);
    if (!isNaN(limit) && limit > 0) {
      return limit;
    }
  }
  return 99;
}

function generateCartItemId(offer) {
  const store = String(offer.store || '').trim();
  const prod = String(offer.product || '').trim();
  const price = String(offer.price || '').trim();
  return `${store}_${prod}_${price}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

function getOfferCartQty(offer) {
  const id = generateCartItemId(offer);
  const item = state.cart.find(i => i.id === id);
  return item ? item.qty : 0;
}

function addToCart(offer, qtyDelta = 1, autoOpenDrawer = false) {
  const id = generateCartItemId(offer);
  const existing = state.cart.find(item => item.id === id);
  const maxQty = existing ? (existing.maxQty || getMaxAllowedQty(offer)) : getMaxAllowedQty(offer);
  const currentQty = existing ? existing.qty : 0;

  if (qtyDelta > 0 && currentQty + qtyDelta > maxQty) {
    showCopyToast(`Max ${maxQty} st per hushåll för denna vara.`);
    return;
  }

  if (existing) {
    existing.qty += qtyDelta;
    if (existing.qty <= 0) {
      removeFromCart(id);
      return;
    }
  } else if (qtyDelta > 0) {
    const { pricePerUnit } = extractPerUnitDealPriceJS(offer.price);
    const origPriceVal = parsePriceNumeric(offer.original_price);
    
    // Estimate regular baseline price (fallback to 1.35x deal price if original_price is missing)
    const baseRegularPrice = origPriceVal > pricePerUnit ? origPriceVal : (pricePerUnit > 0 ? Math.round(pricePerUnit * 1.35 * 100) / 100 : pricePerUnit);

    state.cart.push({
      id: id,
      store: offer.store || 'Butik',
      product: offer.product || '',
      brand: offer.brand || '',
      description: offer.description || '',
      price: offer.price || '',
      pricePerUnit: pricePerUnit,
      origPrice: offer.original_price || '',
      baseRegularPrice: baseRegularPrice,
      image_url: offer.image_url || DEFAULT_IMG,
      qty: qtyDelta,
      maxQty: maxQty,
      checked: false
    });
  }

  saveCartToStorage();
  updateCartUI();

  if (autoOpenDrawer && qtyDelta > 0) {
    toggleCartDrawer(true);
  }
}

function removeFromCart(cartItemId) {
  state.cart = state.cart.filter(item => item.id !== cartItemId);
  saveCartToStorage();
  updateCartUI();
}

function updateCartItemQty(cartItemId, delta) {
  const item = state.cart.find(i => i.id === cartItemId);
  if (!item) return;

  const maxQty = item.maxQty || 99;
  if (delta > 0 && item.qty + delta > maxQty) {
    showCopyToast(`Max ${maxQty} st per hushåll för denna vara.`);
    return;
  }

  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(cartItemId);
    return;
  }
  saveCartToStorage();
  updateCartUI();
}

function toggleCartItemChecked(cartItemId) {
  const item = state.cart.find(i => i.id === cartItemId);
  if (!item) return;
  item.checked = !item.checked;
  saveCartToStorage();
  updateCartUI();
}

function clearCart() {
  if (state.cart.length === 0) return;
  state.cart = [];
  saveCartToStorage();
  updateCartUI();
}

function calculateCartTotals() {
  let totalItems = 0;
  let totalDealCost = 0;
  let totalRegularCost = 0;

  state.cart.forEach(item => {
    const q = item.qty || 1;
    totalItems += q;
    const dealPrice = item.pricePerUnit || parsePriceNumeric(item.price);
    const regPrice = item.baseRegularPrice || dealPrice;

    totalDealCost += dealPrice * q;
    totalRegularCost += (regPrice > dealPrice ? regPrice : dealPrice) * q;
  });

  const totalSavings = Math.max(0, totalRegularCost - totalDealCost);
  const savingsPercent = totalRegularCost > 0 ? Math.round((totalSavings / totalRegularCost) * 100) : 0;

  return {
    totalItems,
    totalDealCost: Math.round(totalDealCost * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
    savingsPercent
  };
}

function updateCartUI() {
  const totals = calculateCartTotals();

  // Badges & Counters
  const headerCount = document.getElementById('cart-header-count');
  if (headerCount) headerCount.textContent = totals.totalItems;

  const floatBadge = document.getElementById('cart-floating-badge');
  if (floatBadge) floatBadge.textContent = totals.totalItems;

  const floatText = document.getElementById('cart-floating-items-text');
  if (floatText) floatText.textContent = `(${totals.totalItems} varor)`;

  const floatSavings = document.getElementById('cart-floating-savings');
  if (floatSavings) floatSavings.textContent = `Sparat: ${totals.totalSavings.toString().replace('.', ',')} kr`;

  const drawerSubtitle = document.getElementById('cart-drawer-subtitle');
  if (drawerSubtitle) drawerSubtitle.textContent = `${totals.totalItems} varor i listan`;

  const totalSavingsEl = document.getElementById('cart-total-savings');
  if (totalSavingsEl) totalSavingsEl.textContent = `${totals.totalSavings.toString().replace('.', ',')} kr`;

  const savingsPctEl = document.getElementById('cart-savings-percent');
  if (savingsPctEl) savingsPctEl.textContent = `-${totals.savingsPercent}%`;

  const totalPriceEl = document.getElementById('cart-total-price');
  if (totalPriceEl) totalPriceEl.textContent = `${totals.totalDealCost.toString().replace('.', ',')} kr`;

  renderCartDrawer();
  renderDeals(); // Re-render grid cards to update buttons
  updateActiveModalCartButton();
}

function getStoreColor(storeName) {
  const s = String(storeName || '').trim();
  if (STORE_COLORS[s]) return STORE_COLORS[s].bg;
  const lower = s.toLowerCase();
  if (lower.includes('ica')) return '#E21936';
  if (lower.includes('willys')) return '#009345';
  if (lower.includes('hemköp')) return '#D31115';
  if (lower.includes('coop')) return '#007A33';
  if (lower.includes('lidl')) return '#00509E';
  return '#4B5563';
}

function renderCartDrawer() {
  const container = document.getElementById('cart-items-container');
  if (!container) return;

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-zinc-400 space-y-3">
        <svg class="w-12 h-12 mx-auto text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"></path>
        </svg>
        <div class="text-sm font-semibold text-zinc-600">Din inköpslista är tom</div>
        <p class="text-xs text-zinc-400 max-w-xs mx-auto">Klicka på "Inköpslista" eller "+"-knappen på valfritt erbjudande för att börja planera dina köp.</p>
      </div>
    `;
    return;
  }

  // Group items by store
  const storeGroups = {};
  state.cart.forEach(item => {
    const s = item.store || 'Övrigt';
    if (!storeGroups[s]) storeGroups[s] = [];
    storeGroups[s].push(item);
  });

  let html = '';
  Object.keys(storeGroups).forEach(storeName => {
    const items = storeGroups[storeName];
    const storeBadgeColor = getStoreColor(storeName);
    const storeItemCount = items.reduce((sum, i) => sum + i.qty, 0);

    html += `
      <div class="bg-white rounded-2xl border border-zinc-200/90 shadow-sm overflow-hidden">
        <!-- Store Group Header -->
        <div class="px-4 py-3 bg-zinc-50/80 border-b border-zinc-100 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${storeBadgeColor};"></span>
            <span class="text-xs font-extrabold uppercase tracking-wide text-zinc-900">${escapeHtml(storeName)}</span>
          </div>
          <span class="text-[11px] font-semibold text-zinc-500 bg-zinc-200/60 px-2 py-0.5 rounded-full">${storeItemCount} varor</span>
        </div>

        <!-- Store Group Items -->
        <div class="divide-y divide-zinc-100">
          ${items.map(item => {
            const isChecked = item.checked;
            const itemTotalCost = (item.pricePerUnit * item.qty).toFixed(2).replace('.', ',');
            const itemSavings = Math.max(0, (item.baseRegularPrice - item.pricePerUnit) * item.qty);
            const maxQty = item.maxQty || 99;
            const isMaxItem = item.qty >= maxQty;

            return `
              <div class="p-3 sm:p-4 flex items-start gap-3 transition-colors ${isChecked ? 'bg-zinc-50/70' : 'hover:bg-zinc-50/40'}">
                <!-- Checkbox -->
                <input 
                  type="checkbox" 
                  data-action="toggle-check" 
                  data-cart-id="${item.id}"
                  ${isChecked ? 'checked' : ''}
                  class="mt-1 w-4 h-4 text-rose-600 rounded border-zinc-300 focus:ring-rose-500 cursor-pointer"
                />

                <!-- Image -->
                <img 
                  src="${item.image_url}" 
                  alt="${escapeHtml(item.product)}" 
                  class="w-12 h-12 object-contain bg-zinc-50 rounded-lg p-1 border border-zinc-100 shrink-0 ${isChecked ? 'opacity-40' : ''}"
                  onerror="this.onerror=null; this.src='${DEFAULT_IMG}';"
                />

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <h4 class="text-xs sm:text-sm font-bold text-zinc-900 leading-tight ${isChecked ? 'line-through text-zinc-400' : ''}">
                    ${escapeHtml(item.product)}
                  </h4>
                  ${item.brand ? `<span class="text-[10px] text-zinc-400 font-semibold uppercase block truncate ${isChecked ? 'line-through' : ''}">${escapeHtml(item.brand)}</span>` : ''}
                  <div class="flex items-baseline gap-2 mt-1">
                    <span class="text-xs font-black text-rose-600">${escapeHtml(item.price)}</span>
                    ${itemSavings > 0 ? `<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60">Sparat ${itemSavings.toFixed(2).replace('.', ',')} kr</span>` : ''}
                  </div>

                  <!-- Qty Modifier Bar -->
                  <div class="flex items-center justify-between mt-2 pt-2 border-t border-zinc-100">
                    <div class="flex items-center gap-1.5 bg-zinc-100 rounded-lg p-0.5 border border-zinc-200/80">
                      <button 
                        data-action="dec-qty" 
                        data-cart-id="${item.id}"
                        class="w-5 h-5 bg-white hover:bg-zinc-50 text-zinc-800 font-bold rounded flex items-center justify-center text-xs shadow-sm cursor-pointer active:scale-90"
                      >-</button>
                      <span class="text-xs font-black text-zinc-900 px-1.5">${item.qty}</span>
                      <button 
                        data-action="inc-qty" 
                        data-cart-id="${item.id}"
                        ${isMaxItem ? 'disabled class="w-5 h-5 bg-zinc-200 text-zinc-400 font-bold rounded flex items-center justify-center text-xs cursor-not-allowed"' : 'class="w-5 h-5 bg-white hover:bg-zinc-50 text-zinc-800 font-bold rounded flex items-center justify-center text-xs shadow-sm cursor-pointer active:scale-90"'}
                        title="${isMaxItem ? `Max ${maxQty} st per hushåll` : 'Öka antal'}"
                      >+</button>
                    </div>

                    <div class="flex items-center gap-3">
                      <span class="text-xs font-extrabold text-zinc-900">${itemTotalCost} kr</span>
                      <button 
                        data-action="remove-item" 
                        data-cart-id="${item.id}"
                        class="text-zinc-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition cursor-pointer"
                        title="Ta bort vara"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function copyCartToClipboard() {
  if (state.cart.length === 0) return;

  const totals = calculateCartTotals();
  const storeGroups = {};
  state.cart.forEach(item => {
    const s = item.store || 'Övrigt';
    if (!storeGroups[s]) storeGroups[s] = [];
    storeGroups[s].push(item);
  });

  let lines = [];
  lines.push('MIN INKÖPSLISTA - VECKANS DEALS');
  lines.push('----------------------------------------');

  Object.keys(storeGroups).forEach(storeName => {
    const items = storeGroups[storeName];
    const storeCount = items.reduce((s, i) => s + i.qty, 0);
    lines.push(`\n[ ${storeName.toUpperCase()} ] (${storeCount} varor)`);
    
    items.forEach(i => {
      const checkMark = i.checked ? '[x]' : '[ ]';
      lines.push(`${checkMark} ${i.qty}x ${i.product} - ${i.price}`);
    });
  });

  lines.push('\n----------------------------------------');
  lines.push(`Totalt erbjudandepris: ${totals.totalDealCost.toString().replace('.', ',')} kr`);
  lines.push(`Beräknad besparing: ${totals.totalSavings.toString().replace('.', ',')} kr (-${totals.savingsPercent}%)`);

  const textToCopy = lines.join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showCopyToast('Inköpslistan har kopierats till urklipp!');
    }).catch(err => {
      console.error('Copy failed', err);
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = textToCopy;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showCopyToast('Inköpslistan har kopierats till urklipp!');
  }
}

function showCopyToast(msg = 'Inköpslistan har kopierats till urklipp!') {
  const toast = document.getElementById('cart-copy-toast');
  if (!toast) return;
  const textEl = toast.querySelector('span');
  if (textEl) textEl.textContent = msg;

  toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
  toast.classList.add('opacity-100', 'translate-y-0');

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-2');
  }, 2500);
}

function toggleCartDrawer(open) {
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  if (!drawer || !backdrop) return;

  if (open) {
    renderCartDrawer();
    backdrop.classList.remove('hidden');
    backdrop.style.display = 'block';
    setTimeout(() => {
      backdrop.classList.remove('opacity-0');
      backdrop.classList.add('opacity-100');
      drawer.classList.remove('translate-x-full');
      drawer.classList.add('translate-x-0');
      drawer.style.transform = 'translateX(0)';
    }, 10);
    document.body.classList.add('overflow-hidden');
  } else {
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
    drawer.style.transform = 'translateX(100%)';
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    setTimeout(() => {
      backdrop.classList.add('hidden');
      backdrop.style.display = 'none';
      document.body.classList.remove('overflow-hidden');
    }, 300);
  }
}

function updateActiveModalCartButton() {
  if (!state.activeModalOffer) return;
  const container = document.getElementById('modal-cart-button-container');
  if (!container) return;

  const offer = state.activeModalOffer;
  const cartQty = getOfferCartQty(offer);
  const maxQty = getMaxAllowedQty(offer);
  const isMaxReached = cartQty >= maxQty;

  if (cartQty === 0) {
    container.innerHTML = `
      <button id="btn-modal-add-cart" type="button" class="w-full sm:w-auto px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs sm:text-sm font-bold transition active:scale-95 cursor-pointer shadow-sm flex items-center justify-center gap-2">
        <svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
        </svg>
        <span>Lägg i inköpslista</span>
      </button>
    `;
  } else {
    container.innerHTML = `
      <div class="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-3 bg-emerald-600 border border-emerald-700 rounded-xl p-1.5 px-3 text-white shadow-sm font-bold text-xs sm:text-sm">
        <button id="btn-modal-dec-cart" type="button" class="w-8 h-8 bg-emerald-700 hover:bg-emerald-800 active:scale-90 rounded-lg text-white font-black flex items-center justify-center cursor-pointer transition-transform text-sm">-</button>
        <span class="px-3 font-black text-white text-xs sm:text-sm whitespace-nowrap">${cartQty}</span>
        <button id="btn-modal-inc-cart" type="button" ${isMaxReached ? 'disabled class="w-8 h-8 bg-emerald-800/40 text-emerald-200/50 cursor-not-allowed rounded-lg font-black flex items-center justify-center text-sm"' : 'class="w-8 h-8 bg-emerald-700 hover:bg-emerald-800 active:scale-90 rounded-lg text-white font-black flex items-center justify-center cursor-pointer transition-transform text-sm"'} title="${isMaxReached ? `Max ${maxQty} per hushåll` : 'Öka antal'}">+</button>
      </div>
    `;
  }
}

// --- Price per kg ---
// Prefer the store's own comparison price (price_per_kg from the scrapers). Otherwise estimate it
// from the price and the package weight. Returns { min, max } – min is when choosing the variant
// with the best value (e.g. the biggest package) – or null when it can't be determined.
function getPricePerKg(offer) {
  if (typeof offer.price_per_kg === 'number') {
    return { min: offer.price_per_kg, max: offer.price_per_kg_max ?? offer.price_per_kg };
  }

  const { pricePerUnit, isExplicitPerKg } = extractPerUnitDealPriceJS(offer.price);
  if (pricePerUnit <= 0) return null;
  if (isExplicitPerKg) return { min: pricePerUnit, max: pricePerUnit };

  const textForWeight = `${offer.product || ''} ${offer.description || ''} ${offer.price || ''}`;
  const weightKg = extractPackageWeightInKgJS(textForWeight);
  if (weightKg <= 0) return null;
  return { min: pricePerUnit / weightKg, max: pricePerUnit / weightKg };
}

function formatKr(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
}

function formatPricePerKg(perKg) {
  if (!perKg) return '';
  const min = Math.round(perKg.min * 100) / 100;
  const max = Math.round(perKg.max * 100) / 100;
  return max > min ? `${formatKr(min)}–${formatKr(max)} kr/kg` : `${formatKr(min)} kr/kg`;
}

function isPricePerKgUnder(offer, limit) {
  const perKg = getPricePerKg(offer);
  return !!perKg && perKg.min < limit;
}

// --- Product groups used by the special filters and "Veckans bästa deal" ---
function getOfferText(offer) {
  return `${offer.product || ''} ${offer.brand || ''} ${offer.description || ''}`.toLowerCase();
}

// Korv, pålägg and ready meals like kebab and köttbullar have their own categories
function isQualifyingMeat(offer) {
  return getCategory(offer) === 'Kött & Fågel';
}

// Coffee: the word "kaffe" (not compounds like "kaffekapslar" or "snabbkaffe") or a coffee brand
const COFFEE_RE = /(?:^|[^a-zåäöé])(?:kaffe|bryggkaffe|pressokaffe|kokkaffe|mellanrost|mörkrost|ljusrost|espressobönor|kaffebönor|gevalia|zoégas|zoegas|löfbergs|arvid nordquist|lavazza)(?![a-zåäöé])/i;

function isCoffee(offer) {
  return COFFEE_RE.test(getOfferText(offer));
}

// --- Helper for Kött & Fågel < 80 kr/kg Filter ---
function isMeatUnder80PerKg(offer) {
  return isQualifyingMeat(offer) && isPricePerKgUnder(offer, 80);
}

// --- Helper for Kaffe < 100 kr/kg Filter ---
function isCoffeeUnder100PerKg(offer) {
  return isCoffee(offer) && isPricePerKgUnder(offer, 100);
}

// --- Arla cheese ---
// Recognised by the word "Arla" only: cheese names like Präst, Herrgård and Grevé
// are also used by other dairies (e.g. "Skånemejerier Grevé")
function isArlaCheese(offer) {
  const brand = (offer.brand || '').toLowerCase();
  const prod = (offer.product || '').toLowerCase();
  const desc = (offer.description || '').toLowerCase();
  const fullText = `${prod} ${brand} ${desc}`.toLowerCase();

  // 1. Must be Arla
  const isArla = brand.includes('arla') || prod.includes('arla') || desc.includes('arla') || /\barla\b/i.test(fullText);
  if (!isArla) return false;

  // 2. Must be cheese
  const textWithoutFrukost = fullText.replace(/frukost/g, '');
  const cheesePattern = /\b(?:ost|ostar|ostskivor|skivost|skivad ost|rivost|riven ost|hushållsost|prästost|präst|herrgård|herrgårdsost|grevé|greve|svecia|gräddost|gouda|edamer|port salut|havarti|mozzarella|feta|färskost|brie|camembert|kvibille|ädelost|blåmögelost|vitmögelost|cheddar|västerbottensost|parmesan|parmigiano|halloumi|norrloumi|grillost|smältost|mjukost|flödeost|familjefavoriter|familjefavorit|billinge)\b/i;
  return cheesePattern.test(textWithoutFrukost);
}

// --- Helper for Ost från Arla < 80 kr/kg Filter ---
function isArlaCheeseUnder80PerKg(offer) {
  return isArlaCheese(offer) && isPricePerKgUnder(offer, 80);
}

// Cheese in "Veckans bästa deal": Arla cheese, but not hushållsost
function isBestDealCheese(offer) {
  return isArlaCheese(offer) && !/\bhushålls?(?:ost)?\b/i.test(getOfferText(offer));
}

// --- Helper for Fun Light Extrapris Filter ---
function isFunLightDeal(offer) {
  // If ordinary price assortment item without promotion, ignore
  if (offer.store === 'Willys Ord.pris' && (!offer.discount_percentage || parseFloat(offer.discount_percentage) <= 0)) {
    return false;
  }

  const text = `${offer.product || ''} ${offer.brand || ''} ${offer.description || ''}`.toLowerCase();
  return text.includes('fun light') || text.includes('funlight') || /\bfun\s*light\b/i.test(text);
}

// Special filter pills: label -> matcher
const SPECIAL_FILTERS = {
  'Kött & Fågel <80 kr/kg': isMeatUnder80PerKg,
  'Arla ost <80 kr/kg': isArlaCheeseUnder80PerKg,
  'Kaffe <100 kr/kg': isCoffeeUnder100PerKg,
  'Fun Light extrapris': isFunLightDeal
};

// Compute Category Counts based on active store filter
function computeCategoryCounts() {
  state.categoryCounts = {};
  for (const cat of ALL_CATEGORIES) {
    state.categoryCounts[cat] = 0;
  }
  for (const label of Object.keys(SPECIAL_FILTERS)) {
    state.categoryCounts[label] = 0;
  }

  for (const offer of getStoreFilteredOffers()) {
    const cat = getCategory(offer);
    state.categoryCounts[cat] = (state.categoryCounts[cat] || 0) + 1;

    for (const [label, matches] of Object.entries(SPECIAL_FILTERS)) {
      if (matches(offer)) state.categoryCounts[label]++;
    }
  }
}

// --- Veckans bästa deal ---
// Usually expensive staples at a really good price. A deal must be under its group's
// price per kg limit. The best one has the biggest discount (compared with the normal
// price), with a bonus for being far below the limit.
// normalPerKg: what the group usually costs in any chain (see getBestDealDiscount)
const BEST_DEAL_GROUPS = [
  { label: 'Kött', maxPerKg: 80, minPerKg: 20, matches: isQualifyingMeat },
  { label: 'Kaffe', maxPerKg: 100, minPerKg: 40, normalPerKg: 150, matches: isCoffee },
  { label: 'Arla-ost', maxPerKg: 80, minPerKg: 30, matches: isBestDealCheese }
];
const BEST_DEAL_RUNNER_UPS = 4;

let bestDeals = [];

function getChainName(store) {
  return String(store || '').trim().split(/[\s(]/)[0];
}

function describePricePerKg(offer) {
  const perKg = getPricePerKg(offer);
  if (!perKg) return '';
  // Without the store's comparison price it's an estimate from the package weight
  return `${typeof offer.price_per_kg === 'number' ? '' : '≈ '}${formatPricePerKg(perKg)}`;
}

// The discount compared with the store's own normal price
function getStoreDiscount(offer) {
  return parseFloat(offer.discount_percentage) || 0;
}

// Normal prices differ between the chains (coffee is often 15–25 % more expensive at ICA than
// at Willys), so in a group where one brand is as good as another, the discount is measured
// from the group's normal price instead – then the cheapest per kg is always the best deal.
function getBestDealDiscount(offer, group, perKg) {
  if (group.normalPerKg) return (1 - perKg.min / group.normalPerKg) * 100;
  // Discounts above 60 % are capped – they are usually data errors
  return Math.min(getStoreDiscount(offer), 60);
}

function findBestDeals() {
  const deals = new Map();
  for (const offer of getStoreFilteredOffers()) {
    const group = BEST_DEAL_GROUPS.find(g => g.matches(offer));
    if (!group) continue;
    const perKg = getPricePerKg(offer);
    // minPerKg filters out obviously broken prices
    if (!perKg || perKg.min >= group.maxPerKg || perKg.min < group.minPerKg) continue;

    const discount = getBestDealDiscount(offer, group, perKg);
    const belowLimit = 1 - perKg.min / group.maxPerKg;
    const score = discount + belowLimit * 20;

    // The same deal in several stores of a chain (e.g. ICA) is shown once. The stores have
    // different normal prices, so the store with the smallest discount represents the deal.
    const chain = getChainName(offer.store);
    const key = `${chain}|${(offer.product || '').toLowerCase()}|${(offer.brand || '').toLowerCase()}|${offer.price}`;
    const existing = deals.get(key);
    if (existing) {
      // Lidl sometimes lists the same product twice – count each store once
      if (!existing.stores.includes(offer.store)) existing.stores.push(offer.store);
      if (getStoreDiscount(offer) < getStoreDiscount(existing.offer)) Object.assign(existing, { offer, perKg, score });
      continue;
    }
    deals.set(key, { offer, group, perKg, chain, stores: [offer.store], score });
  }
  // Remove duplicates across chains. The list is sorted, so the better deal is kept.
  const ranked = [...deals.values()].sort((a, b) => b.score - a.score);
  const unique = [];
  for (const deal of ranked) {
    const sameDeal = unique.find(kept => isSameDealElsewhere(kept, deal));
    if (sameDeal) {
      sameDeal.stores.push(...deal.stores.filter(store => !sameDeal.stores.includes(store)));
      continue;
    }
    const index = unique.findIndex(kept => isSameProduct(kept, deal));
    if (index === -1) {
      unique.push(deal);
    } else if (isSwedishForSamePrice(deal, unique[index])) {
      // The Swedish product takes the other one's place in the list
      unique[index] = { ...deal, score: unique[index].score };
    }
  }
  return unique;
}

// The store says the product comes from Sweden (origin is set when deals.json is built)
function isSwedish(offer) {
  return offer.origin === 'Sverige';
}

// Swedish is always chosen over the same kind of product from elsewhere (or of unknown origin)
// when it costs the same or less per kg
function isSwedishForSamePrice(deal, kept) {
  return isSwedish(deal.offer) && !isSwedish(kept.offer) &&
    (deal.perKg.min <= kept.perKg.min || isSamePricePerKg(deal, kept));
}

// Lowercase without accents or symbols: "ZOÉGAS®" -> "zoegas"
function normalizeName(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Product name without a leading brand: "Zoégas Skånerost" -> "skanerost"
function getCoreProductName(offer) {
  const brand = normalizeName(offer.brand);
  const name = normalizeName(offer.product);
  return brand && name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name;
}

// The kind of product: "färsk" and "svensk" don't change it, and ytterfilé, innerfilé and
// bröstfilé count as filé ("Färsk fläskfilé" and "Svensk fläskytterfilé" are both "flaskfile")
function getProductKind(offer) {
  return getCoreProductName(offer)
    .replace(/\b(?:farsk|svensk)[at]?\b/g, ' ')
    .replace(/(?:ytter|inner|brost)?file(?:er)?\b/g, 'file')
    .replace(/\s+/g, ' ').trim();
}

// Up to 2 % apart counts as the same price per kg
function isSamePricePerKg(a, b) {
  return Math.abs(a.perKg.min - b.perKg.min) <= 0.02 * Math.max(a.perKg.min, b.perKg.min);
}

// The same brand at the same price per kg in another chain (e.g. Zoégas at Willys and Lidl)
function isSameDealElsewhere(a, b) {
  const brand = normalizeName(a.offer.brand);
  return a.group === b.group && !!brand && brand === normalizeName(b.offer.brand) && isSamePricePerKg(a, b);
}

// The same kind of product (e.g. fläskfilé) – only the best price is shown
function isSameProduct(a, b) {
  return a.group === b.group && getProductKind(a.offer) === getProductKind(b.offer);
}

// Two deals from the same chain and brand (e.g. chicken legs and wings) are too similar to show both
function isSimilarDeal(a, b) {
  return a.chain === b.chain && !!a.offer.brand && a.offer.brand === b.offer.brand;
}

// The best deal plus runner-ups: first the best in each group, then the next best overall
function pickBestDeals(ranked) {
  if (ranked.length === 0) return [];
  const picked = [ranked[0]];
  const canPick = (deal) => !picked.includes(deal) && !picked.some(p => isSimilarDeal(p, deal));

  for (const group of BEST_DEAL_GROUPS) {
    const best = ranked.find(d => d.group === group && canPick(d));
    if (best) picked.push(best);
  }
  for (const deal of ranked) {
    if (picked.length > BEST_DEAL_RUNNER_UPS) break;
    if (canPick(deal)) picked.push(deal);
  }
  const runners = picked.slice(1, BEST_DEAL_RUNNER_UPS + 1).sort((a, b) => b.score - a.score);
  return [picked[0], ...runners];
}

function formatDealStores(deal) {
  const chains = [...new Set(deal.stores.map(getChainName))];
  if (chains.length > 1) return chains.join(' + ');
  return deal.stores.length > 1 ? `${deal.chain} · ${deal.stores.length} butiker` : getShortStoreName(deal.offer.store);
}

// "Ursprung Sverige", unless the brand already says it ("ICA. Ursprung Sverige", "Danmark/Danish Crown")
function getOriginText(offer) {
  const countries = (offer.origin || '').split(', ').filter(Boolean);
  if (countries.length === 0 || countries.every(country => (offer.brand || '').includes(country))) return '';
  return `Ursprung ${offer.origin}`;
}

function createBestDealHeroHtml(deal) {
  const { offer, group } = deal;
  const discountPct = Math.round(parseFloat(offer.discount_percentage) || 0);
  const details = [offer.brand, getOriginText(offer), offer.description].filter(Boolean).join(' · ');

  return `
    <article data-best-deal="0" role="button" tabindex="0" class="cursor-pointer group h-full flex flex-col sm:flex-row overflow-hidden rounded-2xl sm:rounded-3xl bg-zinc-900 text-white shadow-lg hover:shadow-xl transition focus:outline-none focus:ring-2 focus:ring-rose-500">
      <div class="relative sm:w-2/5 shrink-0 bg-white flex items-center justify-center p-4 sm:p-6 h-44 sm:h-auto">
        <img src="${escapeHtml(offer.image_url || DEFAULT_IMG)}" alt="${escapeHtml(offer.product || '')}" onerror="this.onerror=null; this.src='${DEFAULT_IMG}';" class="max-h-full sm:max-h-56 max-w-full object-contain transition-transform duration-200 group-hover:scale-105">
        <span class="absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-white shadow-sm" style="background-color: ${getStoreColor(offer.store)};">${escapeHtml(formatDealStores(deal))}</span>
        ${discountPct > 0 ? `<span class="absolute top-3 right-3 bg-rose-600 text-white font-extrabold text-xs px-2 py-0.5 rounded shadow-sm">-${discountPct}%</span>` : ''}
      </div>
      <div class="flex-1 min-w-0 p-5 sm:p-6 flex flex-col justify-between gap-4">
        <div>
          <span class="text-[11px] font-bold uppercase tracking-wider text-amber-300">Veckans bästa deal · ${escapeHtml(group.label)}</span>
          <h3 class="mt-1 text-xl sm:text-2xl font-extrabold leading-tight">${escapeHtml(offer.product || '')}</h3>
          ${details ? `<p class="mt-1 text-xs sm:text-sm text-zinc-400 line-clamp-2">${escapeHtml(details)}</p>` : ''}
        </div>
        <div class="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div class="text-3xl sm:text-4xl font-black tracking-tight leading-none">${escapeHtml(offer.price || '')}</div>
            ${offer.original_price ? `<div class="mt-1.5 text-xs text-zinc-400">Ord.pris <span class="line-through">${escapeHtml(offer.original_price)}</span></div>` : ''}
          </div>
          <div class="text-right">
            <div class="inline-block rounded-lg bg-emerald-400/15 text-emerald-300 px-2.5 py-1 text-sm font-extrabold whitespace-nowrap">${escapeHtml(describePricePerKg(offer))}</div>
            <div class="mt-1 text-[11px] text-zinc-400">Bra pris: under ${group.maxPerKg} kr/kg</div>
          </div>
        </div>
        <span class="inline-flex items-center justify-center w-full sm:w-fit px-4 py-2.5 rounded-xl bg-white text-zinc-900 text-xs sm:text-sm font-bold group-hover:bg-zinc-100 transition">Visa innehåll &amp; pris</span>
      </div>
    </article>
  `;
}

function createBestDealCardHtml(deal, index) {
  const { offer, group } = deal;
  const discountPct = Math.round(parseFloat(offer.discount_percentage) || 0);

  return `
    <article data-best-deal="${index}" role="button" tabindex="0" class="cursor-pointer group flex flex-col overflow-hidden rounded-xl sm:rounded-2xl bg-white border border-zinc-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition focus:outline-none focus:ring-2 focus:ring-rose-500">
      <div class="relative h-24 sm:h-28 bg-zinc-50/70 flex items-center justify-center p-2 border-b border-zinc-100">
        <img src="${escapeHtml(offer.image_url || DEFAULT_IMG)}" alt="${escapeHtml(offer.product || '')}" loading="lazy" onerror="this.onerror=null; this.src='${DEFAULT_IMG}';" class="max-h-full max-w-full object-contain">
        <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-white max-w-[calc(100%-44px)] truncate" style="background-color: ${getStoreColor(offer.store)};">${escapeHtml(formatDealStores(deal))}</span>
        ${discountPct > 0 ? `<span class="absolute top-1.5 right-1.5 bg-rose-600 text-white font-extrabold text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded">-${discountPct}%</span>` : ''}
      </div>
      <div class="p-2.5 sm:p-3 flex flex-col gap-1 flex-grow">
        <span class="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-zinc-400">${escapeHtml(group.label)}</span>
        <h4 class="text-xs sm:text-sm font-bold text-zinc-900 leading-tight line-clamp-2">${escapeHtml(offer.product || '')}</h4>
        <div class="mt-auto pt-1 flex items-end justify-between gap-1 flex-wrap">
          <span class="text-sm sm:text-base font-black text-rose-600 leading-none">${escapeHtml(offer.price || '')}</span>
          <span class="text-[10px] sm:text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 rounded px-1.5 py-0.5 whitespace-nowrap">${escapeHtml(describePricePerKg(offer))}</span>
        </div>
      </div>
    </article>
  `;
}

function renderBestDeals() {
  const section = document.getElementById('best-deal-section');
  const heroEl = document.getElementById('best-deal-hero');
  const runnersEl = document.getElementById('best-deal-runners');
  if (!section || !heroEl || !runnersEl) return;

  bestDeals = pickBestDeals(findBestDeals());
  section.classList.toggle('hidden', bestDeals.length === 0);
  if (bestDeals.length === 0) return;

  const [top, ...runners] = bestDeals;
  heroEl.innerHTML = createBestDealHeroHtml(top);
  runnersEl.innerHTML = runners.map((deal, i) => createBestDealCardHtml(deal, i + 1)).join('');
  runnersEl.classList.toggle('hidden', runners.length === 0);
}

// Render horizontal Category Quick-Filter Pills
function renderCategoryPills() {
  const container = document.getElementById('category-pills-container');
  if (!container) return;

  // Only the real categories – the special filters overlap them
  const totalStoreOffers = ALL_CATEGORIES.reduce((sum, cat) => sum + (state.categoryCounts[cat] || 0), 0);

  let html = `
    <button 
      type="button" 
      data-cat="all" 
      class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 flex items-center gap-1.5 ${
        state.activeCategoryPill === 'all'
          ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm'
          : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300'
      }"
    >
      <span>Alla</span>
      <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
        state.activeCategoryPill === 'all' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-100 text-zinc-600'
      }">${totalStoreOffers}</span>
    </button>
  `;

  // ICA Nära Råbyvägen's Facebook photos, labelled with the day of the newest post
  if (facebook.posts.length > 0) {
    const isFacebookActive = state.activeCategoryPill === FACEBOOK_PILL;
    html += `
      <button
        type="button"
        data-cat="${escapeHtml(FACEBOOK_PILL)}"
        class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
          isFacebookActive
            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
            : 'bg-blue-50 text-blue-950 border-blue-200/90 hover:bg-blue-100 hover:border-blue-300'
        }"
      >
        <span>${escapeHtml(FACEBOOK_PILL)}</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
          isFacebookActive ? 'bg-blue-800 text-blue-100' : 'bg-blue-200/80 text-blue-900'
        }">${escapeHtml(formatPostDay(facebook.posts[0].created_at))}</span>
      </button>
    `;
  }

  for (const cat of ALL_CATEGORIES) {
    const count = state.categoryCounts[cat] || 0;
    if (count === 0 && state.activeCategoryPill !== cat) continue;

    const isActive = state.activeCategoryPill === cat;
    html += `
      <button 
        type="button" 
        data-cat="${escapeHtml(cat)}" 
        class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 flex items-center gap-1.5 ${
          isActive
            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300'
        }"
      >
        <span>${escapeHtml(cat)}</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
          isActive ? 'bg-rose-800 text-rose-100' : 'bg-zinc-100 text-zinc-600'
        }">${count}</span>
      </button>
    `;

    // Render Kött & Fågel <80 kr/kg right after Kött & Fågel
    if (cat === 'Kött & Fågel') {
      const meatUnder80Count = state.categoryCounts['Kött & Fågel <80 kr/kg'] || 0;
      if (meatUnder80Count > 0 || state.activeCategoryPill === 'Kött & Fågel <80 kr/kg') {
        const isMeatUnder80Active = state.activeCategoryPill === 'Kött & Fågel <80 kr/kg';
        html += `
          <button 
            type="button" 
            data-cat="Kött & Fågel <80 kr/kg" 
            class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
              isMeatUnder80Active
                ? 'bg-rose-700 text-white border-rose-700 shadow-sm'
                : 'bg-rose-50 text-rose-900 border-rose-200/90 hover:bg-rose-100 hover:border-rose-300'
            }"
          >
            <span>Kött <80 kr/kg</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              isMeatUnder80Active ? 'bg-rose-900 text-rose-100' : 'bg-rose-200/80 text-rose-900'
            }">${meatUnder80Count}</span>
          </button>
        `;
      }
    }

    // Render Arla ost <80 kr/kg right after Mejeri & Ägg
    if (cat === 'Mejeri & Ägg') {
      const arlaCheeseCount = state.categoryCounts['Arla ost <80 kr/kg'] || 0;
      if (arlaCheeseCount > 0 || state.activeCategoryPill === 'Arla ost <80 kr/kg') {
        const isArlaCheeseActive = state.activeCategoryPill === 'Arla ost <80 kr/kg';
        html += `
          <button 
            type="button" 
            data-cat="Arla ost <80 kr/kg" 
            class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
              isArlaCheeseActive
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-amber-50 text-amber-950 border-amber-200/90 hover:bg-amber-100 hover:border-amber-300'
            }"
          >
            <span>Arla ost <80 kr/kg</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              isArlaCheeseActive ? 'bg-amber-800 text-amber-100' : 'bg-amber-200/80 text-amber-900'
            }">${arlaCheeseCount}</span>
          </button>
        `;
      }
    }

    // Render Kaffe <100 kr/kg right after Skafferi
    if (cat === 'Skafferi') {
      const coffeeCount = state.categoryCounts['Kaffe <100 kr/kg'] || 0;
      if (coffeeCount > 0 || state.activeCategoryPill === 'Kaffe <100 kr/kg') {
        const isCoffeeActive = state.activeCategoryPill === 'Kaffe <100 kr/kg';
        html += `
          <button
            type="button"
            data-cat="Kaffe <100 kr/kg"
            class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
              isCoffeeActive
                ? 'bg-orange-800 text-white border-orange-800 shadow-sm'
                : 'bg-orange-50 text-orange-950 border-orange-200/90 hover:bg-orange-100 hover:border-orange-300'
            }"
          >
            <span>Kaffe &lt;100 kr/kg</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              isCoffeeActive ? 'bg-orange-950 text-orange-100' : 'bg-orange-200/80 text-orange-900'
            }">${coffeeCount}</span>
          </button>
        `;
      }
    }

    // Render Fun Light extrapris right after Dryck
    if (cat === 'Dryck') {
      const funLightCount = state.categoryCounts['Fun Light extrapris'] || 0;
      if (funLightCount > 0 || state.activeCategoryPill === 'Fun Light extrapris') {
        const isFunLightActive = state.activeCategoryPill === 'Fun Light extrapris';
        html += `
          <button 
            type="button" 
            data-cat="Fun Light extrapris" 
            class="cat-pill cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
              isFunLightActive
                ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                : 'bg-purple-50 text-purple-950 border-purple-200/90 hover:bg-purple-100 hover:border-purple-300'
            }"
          >
            <span>Fun Light extrapris</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              isFunLightActive ? 'bg-purple-800 text-purple-100' : 'bg-purple-200/80 text-purple-900'
            }">${funLightCount}</span>
          </button>
        `;
      }
    }
  }

  container.innerHTML = html;

  container.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (cat === 'all') {
        state.activeCategoryPill = 'all';
      } else {
        state.activeCategoryPill = state.activeCategoryPill === cat ? 'all' : cat;
      }
      applyFilters();
    });
  });
}

// Render Sidebar Category Checkboxes
function renderCategoryCheckboxes() {
  const container = document.getElementById('category-checkboxes-container');
  if (!container) return;

  let html = '';
  for (const cat of ALL_CATEGORIES) {
    const count = state.categoryCounts[cat] || 0;
    const isChecked = state.selectedCategories.has(cat);

    html += `
      <label class="flex items-center justify-between text-xs cursor-pointer hover:opacity-80 transition select-none">
        <div class="flex items-center gap-2">
          <input 
            type="checkbox" 
            class="cat-checkbox w-3.5 h-3.5 rounded text-rose-600 focus:ring-rose-500 border-zinc-300" 
            data-cat="${escapeHtml(cat)}"
            ${isChecked ? 'checked' : ''}
          >
          <span class="font-medium text-zinc-800">${escapeHtml(cat)}</span>
        </div>
        <span class="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-zinc-100 text-zinc-600">${count}</span>
      </label>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll('.cat-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const cat = e.target.dataset.cat;
      if (e.target.checked) {
        state.selectedCategories.add(cat);
      } else {
        state.selectedCategories.delete(cat);
      }
      applyFilters();
    });
  });
}

// --- Lidl Date Filtering Logic ---
function parseLidlDates(restrictionStr, today) {
  if (!restrictionStr) return [];
  const regex = /(\d{1,2})\/(\d{1,2})/g;
  const matches = [...restrictionStr.matchAll(regex)];
  const parsed = [];
  
  for (const match of matches) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
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
  
  const dayOfWeek = (today.getDay() + 6) % 7; // Monday is 0
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
// Offers from the selected stores (Lidl also limited to the chosen period)
function getStoreFilteredOffers() {
  const result = state.allOffers.filter(offer => {
    const store = (offer.store || '').trim();
    return store !== 'Lidl' && state.selectedStores.has(store);
  });

  if (state.selectedStores.has('Lidl')) {
    const lidlOffers = state.allOffers.filter(o => o.store === 'Lidl');
    result.push(...filterLidlOffers(lidlOffers, state.lidlPeriod));
  }
  return result;
}

function applyFilters() {
  // Searching finds offers, not Facebook photos
  if (state.activeCategoryPill === FACEBOOK_PILL && state.searchQuery.trim()) {
    state.activeCategoryPill = 'all';
  }

  // 1-2. Filter by selected store and Lidl period
  let result = getStoreFilteredOffers();

  // 3. Filter by Category
  result = result.filter(offer => {
    const specialFilter = SPECIAL_FILTERS[state.activeCategoryPill];
    if (specialFilter) {
      return specialFilter(offer);
    }
    const cat = getCategory(offer);
    if (!state.selectedCategories.has(cat)) return false;
    if (state.activeCategoryPill !== 'all' && state.activeCategoryPill !== cat) return false;
    return true;
  });

  // 4. Search Query Filter
  const rawQ = state.searchQuery.trim();
  const q = rawQ.toLowerCase();

  if (q) {
    const queryTokens = q.split(/\s+/).filter(Boolean);

    result = result.filter(offer => {
      const product = (offer.product || '').toLowerCase();
      const brand = (offer.brand || '').toLowerCase();
      const desc = (offer.description || '').toLowerCase();
      const cat = (offer.category || '').toLowerCase();
      const combined = `${product} ${brand} ${desc} ${cat}`;
      
      if (combined.includes(q)) return true;
      return queryTokens.every(token => combined.includes(token));
    });
  }

  // 5. Sorting
  sortOffers(result, state.sortBy);

  state.filteredOffers = result;

  // 6. Compute counts and render UI
  computeCategoryCounts();
  renderBestDeals();
  renderCategoryPills();
  renderCategoryCheckboxes();
  renderDeals();
  renderResultsCount();
  updateMobileFilterBadge();

  // 7. Willys Reference Prices
  updateWillysReferenceBox(q);

  // 8. The recipes count the offers in the chosen stores
  renderRecipes();
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
      return extractPerUnitDealPriceJS(a.price).pricePerUnit - extractPerUnitDealPriceJS(b.price).pricePerUnit;
    }
    if (sortBy === 'price-desc') {
      return extractPerUnitDealPriceJS(b.price).pricePerUnit - extractPerUnitDealPriceJS(a.price).pricePerUnit;
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

// --- Willys Reference Box Logic ---
// Matches come from deals.json (Willys offers + regular assortment). Willys' own API
// can't be called from the browser – it answers 403 to requests from other sites.

// Common Swedish grocery descriptors / stopwords that shouldn't trigger standalone matches
const SWEDISH_GROCERY_STOPWORDS = new Set([
  'färsk', 'färska', 'fryst', 'frysta', 'djupfryst', 'djupfrysta',
  'ekologisk', 'ekologiska', 'eko', 'svensk', 'svenska', 'lokal', 'lokala',
  'klass', 'delikatess', 'premium', 'gammaldags', 'traditionell', 'klassisk',
  'stor', 'stora', 'liten', 'små', 'mellan', 'extra', 'fin', 'fina',
  'röd', 'röda', 'grön', 'gröna', 'vit', 'vita', 'gul', 'gula',
  'i', 'på', 'med', 'och', 'eller', 'utan', 'av', 'för',
  'påse', 'ask', 'burk', 'flask', 'flaska', 'tub', 'bägare', 'kartong', 'pkt', 'pack', 'styck', 'st', 'ca', 'g', 'kg', 'ml', 'cl', 'l', 'dl'
]);

function extractCoreKeywords(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase().replace(/[^a-zåäö0-9\s]/gi, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);
  const core = tokens.filter(t => t.length >= 2 && !SWEDISH_GROCERY_STOPWORDS.has(t));
  return core.length > 0 ? core : tokens;
}

function getLocalWillysMatches(query) {
  if (!query) return [];
  const q = String(query).trim().toLowerCase();
  if (q.length < 2) return [];

  const coreTokens = extractCoreKeywords(q);
  if (coreTokens.length === 0) return [];

  const pool = [
    ...state.allOffers.filter(o => (o.store || '').toLowerCase().includes('willys')),
    ...state.willysAssortment
  ];

  const scoredMatches = [];
  const seenKeys = new Set();
  const MIN_SCORE = 20;

  for (const item of pool) {
    const prod = (item.product || '').toLowerCase();
    const brand = (item.brand || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const fullText = `${prod} ${brand} ${desc}`;

    let score = 0;

    if (prod === q) {
      score = 100;
    } else if (prod.startsWith(q)) {
      score = 80;
    } else if (prod.includes(q)) {
      score = 60;
    } else {
      // Core token matching
      const matchingCoreInProd = coreTokens.filter(t => prod.includes(t));
      const matchingCoreInFull = coreTokens.filter(t => fullText.includes(t));

      if (matchingCoreInProd.length === coreTokens.length) {
        score = 50;
      } else if (matchingCoreInFull.length === coreTokens.length) {
        score = 40;
      } else if (matchingCoreInProd.length > 0) {
        const matchRatio = matchingCoreInProd.length / coreTokens.length;
        if (matchRatio >= 0.5 || matchingCoreInProd.some(t => t.length >= 4)) {
          score = 25 + (matchingCoreInProd.length * 5);
        }
      } else if (matchingCoreInFull.length > 0) {
        const matchRatio = matchingCoreInFull.length / coreTokens.length;
        if (matchRatio >= 0.5) {
          score = 20;
        }
      }
    }

    if (score >= MIN_SCORE) {
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

function updateWillysReferenceBox(query) {
  const q = (query || '').trim();
  renderReferenceBox(q.length >= 2 ? getLocalWillysMatches(q) : [], q);
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
    'Coop (Ekeby)': 'Coop Ekeby',
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
function createDealCardHtml(offer, index) {
  const store = (offer.store || 'Okänd butik').trim();
  const shortStore = getShortStoreName(store);
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('ica') ? '#E21936' : (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563'));
  
  const cat = getCategory(offer);
  const catBadgeHtml = cat 
    ? `<span class="text-[9px] sm:text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200/60 truncate max-w-full block w-fit mt-0.5">${escapeHtml(cat)}</span>`
    : '';

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

  const restriction = (offer.restriction || '').toLowerCase();
  const isTorSon = restriction.includes('tor') || restriction.includes('sön') || restriction.includes('son');
  const restrictionBadgeHtml = isTorSon 
    ? `<div class="text-[8px] sm:text-[10px] md:text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-1 sm:px-2 py-0.5 rounded w-fit mt-1 truncate max-w-full">Endast Tor-Sön</div>`
    : (offer.restriction ? `<div class="text-[8px] sm:text-[10px] md:text-[11px] font-medium text-amber-600 mt-1 truncate">${escapeHtml(offer.restriction)}</div>` : '');

  const cartQty = getOfferCartQty(offer);
  const maxQty = getMaxAllowedQty(offer);
  const isMaxReached = cartQty >= maxQty;

  const cartButtonHtml = cartQty === 0
    ? `<button data-action="card-add-cart" data-deal-index="${index}" class="mt-2.5 w-full py-2 px-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm">
        <svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
        </svg>
        <span>Inköpslista</span>
       </button>`
    : `<div class="mt-2.5 w-full flex items-center justify-between bg-emerald-600 border border-emerald-700 rounded-xl p-1 text-white shadow-sm font-bold text-xs">
        <button data-action="card-dec-cart" data-deal-index="${index}" class="w-7 h-7 bg-emerald-700 hover:bg-emerald-800 active:scale-90 rounded-lg text-white font-black flex items-center justify-center cursor-pointer transition-transform" title="Minska antal">-</button>
        <span class="px-2 font-black text-white text-xs text-center flex-1">${cartQty}</span>
        <button data-action="card-inc-cart" data-deal-index="${index}" ${isMaxReached ? 'disabled class="w-7 h-7 bg-emerald-800/40 text-emerald-200/50 cursor-not-allowed rounded-lg font-black flex items-center justify-center"' : 'class="w-7 h-7 bg-emerald-700 hover:bg-emerald-800 active:scale-90 rounded-lg text-white font-black flex items-center justify-center cursor-pointer transition-transform"'} title="${isMaxReached ? `Max ${maxQty} st/hushåll` : 'Öka antal'}">+</button>
       </div>`;

  return `
    <div data-deal-index="${index}" class="deal-card cursor-pointer group bg-white rounded-xl sm:rounded-2xl border border-zinc-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-200 flex flex-col h-[320px] sm:h-[390px] md:h-[430px] relative overflow-hidden">
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
          <div class="flex items-center justify-between gap-1 flex-wrap">
            <span class="text-[9px] sm:text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-zinc-400 block truncate">
              ${brandTag}
            </span>
          </div>
          <h3 class="text-xs sm:text-sm md:text-base font-bold text-zinc-900 line-clamp-2 leading-tight mt-0.5" title="${productName}">
            ${productName}
          </h3>
          <p class="text-[9px] sm:text-xs text-zinc-500 mt-0.5 truncate hidden sm:block">
            ${descTag}
          </p>
          ${catBadgeHtml}
        </div>

        <div class="pt-1 sm:pt-2">
          ${origPriceHtml}
          <div class="text-xs sm:text-base md:text-xl font-black text-rose-600 tracking-tight leading-none mt-0.5">
            ${priceStr}
          </div>
          ${discountTagHtml}
          ${restrictionBadgeHtml}
          ${cartButtonHtml}
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

  // The Facebook pill shows the store's photos instead of offers
  const showFacebook = state.activeCategoryPill === FACEBOOK_PILL;
  document.getElementById('facebook-section')?.classList.toggle('hidden', !showFacebook);
  grid.classList.toggle('hidden', showFacebook);
  if (showFacebook) {
    emptyState.classList.add('hidden');
    return;
  }

  if (state.filteredOffers.length === 0) {
    grid.innerHTML = '';
    const descEl = emptyState.querySelector('p');
    if (descEl) {
      if (state.searchQuery) {
        descEl.innerHTML = `Det fanns inga rabatterade veckodeals för "<strong>${escapeHtml(state.searchQuery)}</strong>" den här veckan, men du kan se Willys ordinarie referenspriser ovan.`;
      } else {
        descEl.textContent = 'Det fanns inga erbjudanden som matchade dina valda butiks- och kategorifilter.';
      }
    }
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = state.filteredOffers.map((offer, index) => createDealCardHtml(offer, index)).join('');
}

function renderResultsCount() {
  const countEl = document.getElementById('results-count');
  if (!countEl) return;
  if (state.activeCategoryPill === FACEBOOK_PILL) {
    const images = facebook.posts[facebook.activePost]?.images || [];
    countEl.innerHTML = `Visar <strong class="text-zinc-900 font-bold">${images.length}</strong> bilder från ICA Nära Råbyvägens inlägg`;
    return;
  }
  countEl.innerHTML = `Visar <strong class="text-zinc-900 font-bold">${state.filteredOffers.length}</strong> aktuella erbjudanden`;
}

function renderErrorState(message) {
  const grid = document.getElementById('deals-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="col-span-full bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-700">
        <div class="w-10 h-10 mx-auto mb-2 text-red-500 flex items-center justify-center bg-red-100 rounded-full">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        </div>
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

// --- Product Detail Modal Logic ---
function renderModalWillysReference(productName) {
  const refBox = document.getElementById('modal-willys-ref-box');
  const refItemsContainer = document.getElementById('modal-willys-ref-items');
  if (!refBox || !refItemsContainer) return;

  // Local dataset with strict relevance score
  const matches = productName ? getLocalWillysMatches(productName) : [];

  if (matches.length > 0) {
    refItemsContainer.innerHTML = matches.slice(0, 3).map(ref => `
      <div class="flex items-center justify-between gap-2 border-b border-emerald-200/50 pb-1.5 last:border-0 text-emerald-950">
        <div class="truncate font-medium text-xs">
          <span>${escapeHtml(ref.product || '')}</span>
          ${ref.brand ? `<span class="text-emerald-800 font-normal text-[11px]"> (${escapeHtml(ref.brand)})</span>` : ''}
          ${ref.description ? `<span class="text-emerald-700/80 text-[11px]"> · ${escapeHtml(ref.description)}</span>` : ''}
        </div>
        <span class="font-bold text-emerald-900 bg-emerald-100/90 px-2 py-0.5 rounded text-[11px] whitespace-nowrap ml-2">${escapeHtml(ref.price || ref.original_price || '')}</span>
      </div>
    `).join('');
    refBox.classList.remove('hidden');
  } else {
    refBox.classList.add('hidden');
    refItemsContainer.innerHTML = '';
  }
}

// --- Ingredients (Innehållsförteckning) in Product Modal ---
// Willys/Hemköp: fetched at build time into product_info.json (Axfood's API rejects requests from other sites)
// ICA/Coop: the offer's EAN codes are matched against Willys at build time (product_info.json "eans"),
//           otherwise looked up in Open Food Facts directly from the browser
// Lidl: publishes no ingredients online, so we only link to the product page
const PRODUCT_INFO_URL = 'product_info.json';
const OPEN_FOOD_FACTS_FIELDS = 'lang,product_name,brands,quantity,ingredients_text_sv,ingredients_text_en,ingredients_text,nutriments';
const OPEN_FOOD_FACTS_NUTRIENTS = [
  ['Fett', 'fat'],
  ['Varav mättat fett', 'saturated-fat'],
  ['Kolhydrat', 'carbohydrates'],
  ['Varav sockerarter', 'sugars'],
  ['Fiber', 'fiber'],
  ['Protein', 'proteins'],
  ['Salt', 'salt']
];
const NON_FOOD_CATEGORIES = new Set(['Övrigt', 'Hushåll & Hygien']);

// Allergens are written in CAPITALS by the stores, also inside words like "VETEmjöl"
// (and as _underscored_ text in Open Food Facts)
const UPPERCASE_WORDS_RE = /(^|[^A-Za-zÀ-ÖØ-öø-ÿ])([A-ZÀ-ÖØ-Þ]{3,}(?:[\s-]+[A-ZÀ-ÖØ-Þ]{2,})*)/g;
const ALLERGEN_TAG_OPEN = '<strong class="font-bold text-zinc-900">';

let productInfoPromise = null;
const openFoodFactsCache = new Map();
let ingredientsRequestToken = 0;

function loadProductInfo() {
  if (!productInfoPromise) {
    productInfoPromise = fetch(`${PRODUCT_INFO_URL}?v=${Date.now()}`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => ({ products: data.products || {}, eans: data.eans || {} }))
      .catch(err => {
        productInfoPromise = null; // Retry next time a product is opened
        throw err;
      });
  }
  return productInfoPromise;
}

function formatNutrientNumber(value) {
  const num = Number(value);
  if (!isFinite(num)) return String(value);
  const rounded = num >= 10 ? Math.round(num) : (num >= 1 ? Math.round(num * 10) / 10 : Math.round(num * 100) / 100);
  return String(rounded).replace('.', ',');
}

function normalizeOpenFoodFactsProduct(product, ean) {
  const n = product.nutriments || {};
  const nutrition = {};

  const energy = [];
  const kj = n['energy-kj_100g'] ?? n['energy_100g'];
  if (kj != null) energy.push(`${formatNutrientNumber(kj)} kJ`);
  if (n['energy-kcal_100g'] != null) energy.push(`${formatNutrientNumber(n['energy-kcal_100g'])} kcal`);
  if (energy.length > 0) nutrition['Energi'] = energy.join(' / ');

  for (const [label, key] of OPEN_FOOD_FACTS_NUTRIENTS) {
    const value = n[`${key}_100g`];
    if (value != null && value !== '') nutrition[label] = `${formatNutrientNumber(value)} g`;
  }

  // Swedish first, English as fallback – skip other languages (e.g. Finnish for Fazer products)
  const swedish = (product.ingredients_text_sv || (product.lang === 'sv' ? product.ingredients_text : '') || '').trim();
  const english = (product.ingredients_text_en || (product.lang === 'en' ? product.ingredients_text : '') || '').trim();

  return {
    name: product.product_name || '',
    details: [product.brands, product.quantity].filter(Boolean).join(', '),
    ingredients: swedish || english,
    language_note: swedish ? '' : (english
      ? 'Finns bara på engelska i Open Food Facts:'
      : (product.ingredients_text ? 'Innehållsförteckningen finns bara på ett annat språk i Open Food Facts.' : '')),
    nutrition_basis: 'per 100 g/ml',
    nutrition,
    origin: '',
    source: 'Open Food Facts',
    url: `https://world.openfoodfacts.org/product/${encodeURIComponent(ean)}`
  };
}

function fetchOpenFoodFactsProduct(ean) {
  if (!openFoodFactsCache.has(ean)) {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${OPEN_FOOD_FACTS_FIELDS}`;
    const request = fetch(url)
      .then(response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => (data && data.status === 1 && data.product) ? normalizeOpenFoodFactsProduct(data.product, ean) : null)
      .catch(err => {
        openFoodFactsCache.delete(ean); // Network error – retry next time
        throw err;
      });
    openFoodFactsCache.set(ean, request);
  }
  return openFoodFactsCache.get(ean);
}

function formatIngredientsHtml(text) {
  let html = escapeHtml(text).replace(/_([^_]+)_/g, `${ALLERGEN_TAG_OPEN}$1</strong>`);

  // Bold words in CAPITALS – unless the whole text is written in capitals
  const letterCount = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const upperCount = (text.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
  if (letterCount > 0 && upperCount / letterCount < 0.5) {
    html = html.replace(UPPERCASE_WORDS_RE, `$1${ALLERGEN_TAG_OPEN}$2</strong>`);
  }
  return html;
}

function setIngredientsContent(html) {
  const content = document.getElementById('modal-ingredients-content');
  if (content) content.innerHTML = html;
}

function renderIngredientsLoading() {
  setIngredientsContent(`
    <div class="space-y-2 animate-pulse" aria-label="Laddar innehållsförteckning">
      <div class="h-2.5 bg-zinc-200 rounded w-full"></div>
      <div class="h-2.5 bg-zinc-200 rounded w-11/12"></div>
      <div class="h-2.5 bg-zinc-200 rounded w-3/4"></div>
    </div>
  `);
}

function renderIngredientsMessage(text, linkHtml = '') {
  setIngredientsContent(`<p class="text-zinc-500 leading-relaxed">${escapeHtml(text)}${linkHtml ? ` ${linkHtml}` : ''}</p>`);
}

function renderIngredientsProduct(product, offer, { showName, sourceHtml }) {
  const nutritionRows = Object.entries(product.nutrition || {});
  if (!product.ingredients && nutritionRows.length === 0) {
    renderIngredientsMessage(`${product.source} har ingen innehållsförteckning för den här varan.`);
    return;
  }

  const parts = [];

  // Show which product the data is for when the offer has a generic name (e.g. "Chips, ostsnacks")
  if (showName && product.name && product.name.toLowerCase() !== String(offer.product || '').toLowerCase()) {
    const details = product.details ? ` <span class="text-zinc-400">(${escapeHtml(product.details)})</span>` : '';
    parts.push(`<p class="text-zinc-500">Gäller: <span class="font-semibold text-zinc-700">${escapeHtml(product.name)}</span>${details}</p>`);
  }

  if (product.ingredients) {
    if (product.language_note) {
      parts.push(`<p class="text-zinc-400 italic">${escapeHtml(product.language_note)}</p>`);
    }
    parts.push(`<p class="text-zinc-700 leading-relaxed">${formatIngredientsHtml(product.ingredients)}</p>`);
  } else {
    parts.push(`<p class="text-zinc-500">${escapeHtml(product.language_note || 'Ingen innehållsförteckning angiven.')}</p>`);
  }

  if (product.origin) {
    parts.push(`<p class="text-zinc-600">${escapeHtml(product.origin)}</p>`);
  }

  if (nutritionRows.length > 0) {
    parts.push(`
      <details class="border-t border-zinc-100 pt-2.5">
        <summary class="cursor-pointer select-none font-semibold text-zinc-700">Näringsvärde ${escapeHtml(product.nutrition_basis || '')}</summary>
        <table class="w-full mt-1.5 text-zinc-700">
          <tbody class="divide-y divide-zinc-100">
            ${nutritionRows.map(([label, value]) => `
              <tr>
                <td class="py-1 pr-3">${escapeHtml(label)}</td>
                <td class="py-1 text-right font-semibold whitespace-nowrap">${escapeHtml(value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </details>
    `);
  }

  parts.push(`<p class="text-[11px] text-zinc-400 leading-snug">Källa: ${sourceHtml}. Kontrollera alltid förpackningen om du har allergier.</p>`);
  setIngredientsContent(parts.join(''));
}

// ICA/Coop variant that Willys also sells (matched on EAN code at build time)
function getMatchedStoreProduct(info, ean) {
  const code = info && info.eans[ean];
  const product = code && info.products[code];
  return product && (product.ingredients || Object.keys(product.nutrition || {}).length > 0) ? product : null;
}

async function showVariantIngredients(offer, variant, hasVariantPicker) {
  const token = ++ingredientsRequestToken;
  renderIngredientsLoading();
  try {
    const info = await loadProductInfo().catch(() => null);
    const storeProduct = getMatchedStoreProduct(info, variant.ean);
    const offProduct = storeProduct ? null : await fetchOpenFoodFactsProduct(variant.ean);
    if (token !== ingredientsRequestToken) return;

    if (storeProduct) {
      const sameChain = getChainName(offer.store) === storeProduct.source;
      const sourceHtml = escapeHtml(sameChain ? storeProduct.source : `${storeProduct.source}, som säljer samma vara`);
      renderIngredientsProduct(storeProduct, offer, { showName: !hasVariantPicker, sourceHtml });
    } else if (offProduct && (offProduct.ingredients || Object.keys(offProduct.nutrition).length > 0)) {
      const sourceHtml = `<a href="${escapeHtml(offProduct.url)}" target="_blank" rel="noopener noreferrer" class="underline hover:text-zinc-600">Open Food Facts</a> (öppen databas där användare bidrar – kan innehålla fel)`;
      renderIngredientsProduct(offProduct, offer, { showName: !hasVariantPicker, sourceHtml });
    } else {
      renderIngredientsMessage(hasVariantPicker
        ? 'Ingen innehållsförteckning hittades för den här varianten – prova en annan i listan.'
        : 'Ingen innehållsförteckning hittades för den här varan.');
    }
  } catch (err) {
    if (token === ingredientsRequestToken) {
      renderIngredientsMessage('Kunde inte hämta innehållsförteckningen just nu. Försök igen om en stund.');
    }
  }
}

async function renderModalIngredients(offer) {
  const box = document.getElementById('modal-ingredients-box');
  const select = document.getElementById('modal-ingredients-variant');
  if (!box || !select) return;

  const token = ++ingredientsRequestToken;
  select.classList.add('hidden');
  select.innerHTML = '';
  select.onchange = null;

  const variants = Array.isArray(offer.eans) ? offer.eans.filter(v => v && v.ean) : [];
  const cat = getCategory(offer);

  // 1. Willys/Hemköp: product_info.json
  if (offer.product_code) {
    box.classList.remove('hidden');
    renderIngredientsLoading();
    try {
      const info = await loadProductInfo();
      if (token !== ingredientsRequestToken) return;
      const product = info.products[offer.product_code];
      if (product) {
        renderIngredientsProduct(product, offer, { showName: true, sourceHtml: escapeHtml(product.source) });
      } else {
        renderIngredientsMessage('Innehållsförteckningen för den här varan har inte hämtats än. Den läggs till vid nästa uppdatering.');
      }
    } catch (err) {
      if (token === ingredientsRequestToken) {
        renderIngredientsMessage('Kunde inte ladda innehållsförteckningen just nu. Försök igen om en stund.');
      }
    }
    return;
  }

  // 2. ICA/Coop: EAN codes -> same product at Willys, else Open Food Facts.
  //    With a picker when the offer covers several variants.
  if (variants.length > 0) {
    box.classList.remove('hidden');
    const hasVariantPicker = variants.length > 1;
    if (hasVariantPicker) {
      select.innerHTML = variants.map((v, i) => `<option value="${i}">${escapeHtml(v.name || `EAN ${v.ean}`)}</option>`).join('');
      select.classList.remove('hidden');
      select.onchange = () => showVariantIngredients(offer, variants[Number(select.value)], true);
    }

    // Preselect the first variant with ingredients: Willys matches first,
    // otherwise the first four variants are checked in Open Food Facts in parallel
    renderIngredientsLoading();
    const info = await loadProductInfo().catch(() => null);
    if (token !== ingredientsRequestToken) return;
    let index = variants.findIndex(v => getMatchedStoreProduct(info, v.ean)?.ingredients);
    if (index === -1) {
      const results = await Promise.all(variants.slice(0, 4).map(v => fetchOpenFoodFactsProduct(v.ean).catch(() => null)));
      if (token !== ingredientsRequestToken) return;
      index = Math.max(0, results.findIndex(p => p && p.ingredients));
    }
    select.value = String(index);
    showVariantIngredients(offer, variants[index], hasVariantPicker);
    return;
  }

  // 3. Lidl (food only): no ingredients online, link to the product page instead
  if (offer.product_url && !NON_FOOD_CATEGORIES.has(cat)) {
    box.classList.remove('hidden');
    const link = `<a href="${escapeHtml(offer.product_url)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-zinc-700 underline hover:text-zinc-900">Visa varan på lidl.se</a>`;
    renderIngredientsMessage('Lidl publicerar inte innehållsförteckningar på sin webbplats.', link);
    return;
  }

  box.classList.add('hidden');
}

function openProductModal(offer) {
  state.activeModalOffer = offer;
  const backdrop = document.getElementById('product-modal-backdrop');
  const modal = document.getElementById('product-modal');
  if (!backdrop || !modal) return;

  const store = (offer.store || 'Okänd butik').trim();
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('ica') ? '#E21936' : (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563'));
  const cat = getCategory(offer);
  const discountPct = parseFloat(offer.discount_percentage) || 0;
  const productName = offer.product || 'Okänd produkt';
  const brandName = offer.brand || '';
  const descText = offer.description || '';
  const priceText = offer.price || 'Se pris i butik';
  const origPriceText = offer.original_price || '';
  const discountType = (offer.discount && offer.discount !== 'GENERAL') ? offer.discount : '';
  const restriction = offer.restriction || '';

  // Store Badge & Category Badge
  const storeBadge = document.getElementById('modal-store-badge');
  if (storeBadge) {
    storeBadge.textContent = store;
    storeBadge.style.backgroundColor = storeBadgeColor;
  }

  const catBadge = document.getElementById('modal-category-badge');
  if (catBadge) {
    catBadge.textContent = cat;
  }

  // Image & Discount Pct Badge
  const imgEl = document.getElementById('modal-product-image');
  if (imgEl) {
    imgEl.src = offer.image_url || DEFAULT_IMG;
    imgEl.onerror = () => { imgEl.src = DEFAULT_IMG; };
  }

  const pctBadge = document.getElementById('modal-discount-pct-badge');
  if (pctBadge) {
    if (discountPct > 0) {
      pctBadge.textContent = `-${Math.round(discountPct)}%`;
      pctBadge.classList.remove('hidden');
    } else {
      pctBadge.classList.add('hidden');
    }
  }

  // Title, Brand & Description
  const brandTag = document.getElementById('modal-brand-tag');
  if (brandTag) {
    if (brandName) {
      brandTag.textContent = brandName;
      brandTag.classList.remove('hidden');
    } else {
      brandTag.classList.add('hidden');
    }
  }

  const titleEl = document.getElementById('modal-product-title');
  if (titleEl) titleEl.textContent = productName;

  const descEl = document.getElementById('modal-product-desc');
  if (descEl) {
    if (descText) {
      descEl.textContent = descText;
      descEl.classList.remove('hidden');
    } else {
      descEl.classList.add('hidden');
    }
  }

  // Price & Savings
  const priceEl = document.getElementById('modal-product-price');
  if (priceEl) priceEl.textContent = priceText;

  const discountTagEl = document.getElementById('modal-discount-tag');
  if (discountTagEl) {
    if (discountType) {
      discountTagEl.textContent = discountType;
      discountTagEl.classList.remove('hidden');
    } else {
      discountTagEl.classList.add('hidden');
    }
  }

  const origPriceContainer = document.getElementById('modal-original-price-container');
  const origPriceEl = document.getElementById('modal-original-price');
  const savingsEl = document.getElementById('modal-savings-amount');

  // Per item for "3 för 99" offers, per kg for kilo prices
  const { pricePerUnit: parsedDealPrice, isExplicitPerKg } = extractPerUnitDealPriceJS(priceText);
  const isMultiBuy = /\d+\s*(?:st)?\s*f[öo]r/i.test(priceText);
  const parsedOrigPrice = parsePriceNumeric(origPriceText);
  let savingsSek = 0;

  if (parsedOrigPrice > 0 && parsedDealPrice > 0 && parsedOrigPrice > parsedDealPrice) {
    savingsSek = Math.round((parsedOrigPrice - parsedDealPrice) * 100) / 100;
  }

  if (origPriceText && origPriceContainer && origPriceEl) {
    origPriceEl.textContent = origPriceText;
    origPriceContainer.classList.remove('hidden');
  } else if (origPriceContainer) {
    origPriceContainer.classList.add('hidden');
  }

  if (savingsSek > 0 && savingsEl) {
    const savingsUnit = isExplicitPerKg ? ' kr/kg' : (isMultiBuy ? ' kr/st' : ' kr');
    savingsEl.textContent = `Du sparar ${formatKr(savingsSek)}${savingsUnit}!`;
    savingsEl.classList.remove('hidden');
  } else if (savingsEl) {
    savingsEl.classList.add('hidden');
  }

  // Comparison price per kg
  const comparePriceEl = document.getElementById('modal-compare-price');
  if (comparePriceEl) {
    const comparePrice = describePricePerKg(offer);
    comparePriceEl.textContent = comparePrice ? `Jmf-pris ${comparePrice}` : '';
    comparePriceEl.classList.toggle('hidden', !comparePrice);
  }

  // Restrictions / Terms Box
  const restrictionBox = document.getElementById('modal-restriction-box');
  const restrictionText = document.getElementById('modal-restriction-text');
  if (restrictionBox && restrictionText) {
    if (restriction) {
      restrictionText.textContent = restriction;
      restrictionBox.classList.remove('hidden');
    } else {
      restrictionBox.classList.add('hidden');
    }
  }

  // Ingredients (Async: product_info.json or Open Food Facts)
  renderModalIngredients(offer);

  // Willys Reference Price Box inside Modal (Async & strict score matching)
  renderModalWillysReference(productName);

  // Update modal cart button state
  updateActiveModalCartButton();

  // Show Modal with Animation
  backdrop.classList.remove('hidden');
  void backdrop.offsetWidth;
  backdrop.classList.remove('opacity-0');
  backdrop.classList.add('opacity-100');

  modal.classList.remove('scale-95', 'opacity-0');
  modal.classList.add('scale-100', 'opacity-100');

  document.body.classList.add('overflow-hidden');
}

function closeProductModal() {
  const backdrop = document.getElementById('product-modal-backdrop');
  const modal = document.getElementById('product-modal');
  if (!backdrop || !modal) return;

  modal.classList.remove('scale-100', 'opacity-100');
  modal.classList.add('scale-95', 'opacity-0');

  backdrop.classList.remove('opacity-100');
  backdrop.classList.add('opacity-0');

  setTimeout(() => {
    backdrop.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }, 300);
}

// --- ICA Nära Råbyvägen on Facebook ---
// The store posts photos of its price signs ("Prisfest, bara idag!"), usually without text.
// build_facebook.py saves the latest posts in facebook.json and the photos are shown as they are,
// in place of the offers when their category pill is chosen.
const FACEBOOK_URL = 'facebook.json';
const FACEBOOK_PILL = 'Råbyvägen på Facebook'; // state.activeCategoryPill while the photos are shown
const FACEBOOK_MAX_AGE_DAYS = 7; // no pill when the newest post is older

const facebook = {
  posts: [],
  activePost: 0,
  viewerIndex: 0
};

async function fetchFacebookPosts() {
  try {
    const response = await fetch(`${FACEBOOK_URL}?v=${Date.now()}`);
    if (!response.ok) return;
    const data = await response.json();
    const posts = (data.posts || []).filter(post => (post.images || []).length > 0 || post.text);
    const newest = posts[0];
    if (!newest || Date.now() - new Date(newest.created_at) > FACEBOOK_MAX_AGE_DAYS * 24 * 3600 * 1000) return;

    facebook.posts = posts;
    facebook.activePost = 0;
    renderFacebookSection();
    // Adds the pill (applyFilters renders the pills if the offers aren't loaded yet)
    if (state.allOffers.length > 0) renderCategoryPills();
  } catch (error) {
    console.error('Fel vid hämtning av Facebook-inlägg:', error);
  }
}

// "Idag", "Igår" or "fre 26 sep.", in Swedish time
function formatPostDay(isoDate) {
  const zone = { timeZone: 'Europe/Stockholm' };
  const date = new Date(isoDate);
  const dayOf = d => d.toLocaleDateString('sv-SE', zone);
  const now = new Date();
  if (dayOf(date) === dayOf(now)) return 'Idag';
  if (dayOf(date) === dayOf(new Date(now.getTime() - 24 * 3600 * 1000))) return 'Igår';
  return date.toLocaleDateString('sv-SE', { ...zone, weekday: 'short', day: 'numeric', month: 'short' });
}

// "Idag 09:17", "Igår 13:32" or "fre 26 sep. 13:32"
function formatPostTime(isoDate) {
  const time = new Date(isoDate).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
  return `${formatPostDay(isoDate)} ${time}`;
}

function renderFacebookSection() {
  const tabsEl = document.getElementById('facebook-tabs');
  const linkEl = document.getElementById('facebook-post-link');
  const textEl = document.getElementById('facebook-text');
  const imagesEl = document.getElementById('facebook-images');
  if (!tabsEl || !linkEl || !textEl || !imagesEl) return;

  const post = facebook.posts[facebook.activePost];
  if (!post) return;

  tabsEl.innerHTML = facebook.posts.map((p, i) => {
    const active = i === facebook.activePost;
    const colors = active
      ? 'bg-zinc-900 text-white border-zinc-900'
      : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300';
    return `<button type="button" role="tab" aria-selected="${active}" data-facebook-post="${i}" class="px-3 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer whitespace-nowrap ${colors}">${escapeHtml(formatPostTime(p.created_at))}</button>`;
  }).join('');

  linkEl.href = post.url;
  textEl.firstElementChild.textContent = post.text || '';
  textEl.classList.toggle('hidden', !post.text);

  const images = post.images || [];
  imagesEl.innerHTML = images.map((image, i) => `
    <button type="button" data-facebook-image="${i}" class="w-full rounded-xl sm:rounded-2xl overflow-hidden bg-zinc-100 border border-zinc-200/80 hover:opacity-90 transition cursor-zoom-in" style="aspect-ratio: ${Number(image.width) || 3} / ${Number(image.height) || 4};" aria-label="Visa bild ${i + 1} av ${images.length}">
      <img src="${escapeHtml(image.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover">
    </button>`).join('');
  // The number of photos is shown instead of the number of offers
  if (state.activeCategoryPill === FACEBOOK_PILL) renderResultsCount();
}

function openFacebookViewer(index) {
  const viewer = document.getElementById('facebook-viewer');
  if (!viewer) return;
  facebook.viewerIndex = index;
  showFacebookViewerImage();
  viewer.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  document.getElementById('facebook-viewer-close')?.focus();
}

function closeFacebookViewer() {
  const viewer = document.getElementById('facebook-viewer');
  if (!viewer || viewer.classList.contains('hidden')) return;
  viewer.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

// Shows the photo `step` places from the current one, wrapping around
function showFacebookViewerImage(step = 0) {
  const images = facebook.posts[facebook.activePost]?.images || [];
  if (images.length === 0) return;
  facebook.viewerIndex = (facebook.viewerIndex + step + images.length) % images.length;

  const imageEl = document.getElementById('facebook-viewer-image');
  imageEl.src = images[facebook.viewerIndex].url;
  imageEl.alt = `Bild ${facebook.viewerIndex + 1} av ${images.length} från Facebook`;
  document.getElementById('facebook-viewer-counter').textContent = `${facebook.viewerIndex + 1} / ${images.length}`;
  document.getElementById('facebook-viewer-prev').classList.toggle('hidden', images.length < 2);
  document.getElementById('facebook-viewer-next').classList.toggle('hidden', images.length < 2);
}

function setupFacebookSection() {
  document.getElementById('facebook-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-facebook-post]');
    if (!tab) return;
    facebook.activePost = parseInt(tab.dataset.facebookPost, 10);
    renderFacebookSection();
  });

  const imagesEl = document.getElementById('facebook-images');
  if (imagesEl) {
    imagesEl.addEventListener('click', (e) => {
      const button = e.target.closest('[data-facebook-image]');
      if (button) openFacebookViewer(parseInt(button.dataset.facebookImage, 10));
    });

    // Facebook's image links expire after a few days (build_facebook.py renews them in time)
    imagesEl.addEventListener('error', (e) => {
      if (e.target.tagName !== 'IMG') return;
      const message = document.createElement('span');
      message.className = 'flex items-center justify-center h-full p-3 text-center text-[11px] font-semibold text-zinc-500';
      message.textContent = 'Bilden gick inte att visa. Öppna inlägget på Facebook.';
      e.target.replaceWith(message);
    }, true);
  }

  const viewer = document.getElementById('facebook-viewer');
  if (!viewer) return;
  document.getElementById('facebook-viewer-close').addEventListener('click', closeFacebookViewer);
  document.getElementById('facebook-viewer-prev').addEventListener('click', () => showFacebookViewerImage(-1));
  document.getElementById('facebook-viewer-next').addEventListener('click', () => showFacebookViewerImage(1));
  // A click next to the photo closes the viewer
  viewer.addEventListener('click', (e) => {
    if (e.target === viewer) closeFacebookViewer();
  });

  window.addEventListener('keydown', (e) => {
    if (viewer.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeFacebookViewer();
    else if (e.key === 'ArrowLeft') showFacebookViewerImage(-1);
    else if (e.key === 'ArrowRight') showFacebookViewerImage(1);
  });

  // Swipe between the photos on phones
  let touchStartX = null;
  viewer.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  viewer.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const distance = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) > 40) showFacebookViewerImage(distance < 0 ? 1 : -1);
  });
}

// --- Recept ---
// Dinner recipes from ica.se whose protein is on offer (deals.json "recipes", built by
// scrapers/recipes.py). Each ingredient lists the offers (indexes in deals.json "offers") that
// are that ingredient. Only offers in the chosen stores count, and the recipes with the most
// ingredients on offer come first.
const RECIPES_PAGE_SIZE = 24;

const RECIPES_URL = 'recipes.json';

const recipes = {
  all: [],
  status: 'idle', // 'idle' | 'loading' | 'loaded' | 'error'
  offersUpdatedAt: null,
  shown: RECIPES_PAGE_SIZE,
  activeProtein: 'all',
  cheapMeat: false // only recipes whose meat is under 80 kr/kg ("Kött <80 kr/kg")
};

// Loaded the first time the recipes tab is opened
async function fetchRecipes() {
  if (recipes.status !== 'idle') return;
  recipes.status = 'loading';
  try {
    const response = await fetch(`${RECIPES_URL}?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    recipes.all = data.recipes || [];
    recipes.offersUpdatedAt = data.offers_updated_at || null;
    recipes.status = 'loaded';
  } catch (error) {
    console.error('Fel vid hämtning av recept:', error);
    recipes.status = 'error';
  }
  renderRecipes();
}

function isRecipesView() {
  return location.hash === '#recept';
}

// Shows the offers or the recipes, from the address (#recept)
function renderView() {
  const showRecipes = isRecipesView();
  document.getElementById('recipes-view')?.classList.toggle('hidden', !showRecipes);
  document.getElementById('offers-view')?.classList.toggle('hidden', showRecipes);
  document.getElementById('best-deal-wrapper')?.classList.toggle('hidden', showRecipes);
  document.querySelectorAll('[data-view-tab]').forEach(tab => {
    const active = (tab.dataset.viewTab === 'recipes') === showRecipes;
    tab.classList.toggle('bg-white', active);
    tab.classList.toggle('text-zinc-900', active);
    tab.classList.toggle('shadow-sm', active);
    tab.classList.toggle('text-zinc-500', !active);
    tab.classList.toggle('hover:text-zinc-800', !active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  if (showRecipes) {
    fetchRecipes();
    renderRecipes();
  }
}

// The offers of a recipe's ingredient in the chosen stores
function getIngredientOffers(ingredient, available) {
  return (ingredient.offers || []).map(i => state.allOffers[i]).filter(offer => offer && available.has(offer));
}

// The best offer for an ingredient: the lowest price per kg, otherwise the biggest discount
function pickIngredientOffer(offers) {
  const perKg = offer => getPricePerKg(offer)?.min ?? Infinity;
  return [...offers].sort((a, b) =>
    perKg(a) - perKg(b) || (parseFloat(b.discount_percentage) || 0) - (parseFloat(a.discount_percentage) || 0)
  )[0];
}

// A rating with few votes counts less (3.5 stars from 20 votes are added)
function getRecipeRatingScore(recipe) {
  const votes = recipe.votes || 0;
  return ((recipe.rating || 0) * votes + 3.5 * 20) / (votes + 20);
}

// The recipes whose protein is on offer in the chosen stores, best first
function getRankedRecipes() {
  const available = new Set(getStoreFilteredOffers());
  const ranked = [];
  for (const recipe of recipes.all) {
    // The same product on two lines ("4 msk smör" and "25 g smör") counts once
    const seen = new Set();
    const ingredients = recipe.ingredients.map(ingredient => {
      const offers = getIngredientOffers(ingredient, available);
      const key = (ingredient.offers || []).join(',');
      const duplicate = offers.length > 0 && seen.has(key);
      if (offers.length > 0) seen.add(key);
      return { ...ingredient, available: offers, duplicate };
    });
    const protein = ingredients.find(ingredient => ingredient.protein);
    if (!protein || protein.available.length === 0) continue;
    const onOffer = ingredients.filter(ingredient => ingredient.available.length > 0 && !ingredient.duplicate).length;
    const total = ingredients.filter(ingredient => !ingredient.duplicate).length;
    // The protein's offers in "Kött <80 kr/kg" (raw meat under 80 kr/kg)
    const cheapMeat = protein.available.filter(isMeatUnder80PerKg);
    ranked.push({ recipe, ingredients, onOffer, total, cheapMeat, ratingScore: getRecipeRatingScore(recipe) });
  }
  return ranked.sort((a, b) => b.onOffer - a.onOffer || b.ratingScore - a.ratingScore);
}

function createRecipeOfferHtml(ingredient, recipeIndex, ingredientIndex) {
  const offer = pickIngredientOffer(ingredient.available);
  const perKg = getPricePerKg(offer);
  const isPerKg = /kg/i.test(offer.price || '');
  const priceText = perKg && isPerKg ? formatPricePerKg(perKg) : (offer.price || '');
  // The protein's price per kg also when it is sold per piece
  const perKgHtml = ingredient.protein && perKg && !isPerKg
    ? `<span class="block text-[10px] font-semibold text-zinc-500 text-right">${escapeHtml(formatPricePerKg(perKg))}</span>`
    : '';
  const more = ingredient.available.length > 1 ? ` <span class="text-zinc-400 font-medium">+${ingredient.available.length - 1}</span>` : '';
  return `
    <li>
      <button type="button" data-recipe-offer="${recipeIndex}:${ingredientIndex}" class="w-full flex items-center gap-2.5 p-1.5 -mx-1.5 rounded-lg hover:bg-rose-50/70 transition text-left cursor-pointer">
        <img src="${escapeHtml(offer.image_url || DEFAULT_IMG)}" alt="" loading="lazy" onerror="this.onerror=null; this.src='${DEFAULT_IMG}';" class="w-9 h-9 object-contain rounded-md bg-zinc-50 border border-zinc-100 shrink-0">
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-semibold text-zinc-900 truncate">${escapeHtml(ingredient.text)}</span>
          <span class="block text-[11px] text-zinc-500 truncate">${escapeHtml(offer.product || '')} · ${escapeHtml(getShortStoreName(offer.store))}${more}</span>
        </span>
        <span class="whitespace-nowrap">
          <span class="block text-xs font-extrabold text-rose-600 text-right">${escapeHtml(priceText)}</span>
          ${perKgHtml}
        </span>
      </button>
    </li>`;
}

function createRecipeCardHtml(entry, recipeIndex) {
  const { recipe, ingredients, onOffer, total } = entry;
  const offered = ingredients
    .map((ingredient, i) => ({ ingredient, i }))
    .filter(({ ingredient }) => ingredient.available.length > 0 && !ingredient.duplicate)
    // The protein first
    .sort((a, b) => b.ingredient.protein - a.ingredient.protein);
  const others = ingredients.filter(ingredient => ingredient.available.length === 0);

  const meta = [
    recipe.cooking_time,
    recipe.difficulty,
    recipe.portions ? `${recipe.portions} port` : ''
  ].filter(Boolean).map(escapeHtml).join(' · ');
  const ratingHtml = recipe.rating
    ? `<span class="flex items-center gap-1"><svg class="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>${String(recipe.rating).replace('.', ',')}<span class="text-zinc-400">(${recipe.votes || 0})</span></span>`
    : '';

  return `
    <article class="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden flex flex-col">
      <a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener" class="block relative aspect-[4/3] bg-zinc-100 overflow-hidden group">
        ${recipe.image_url ? `<img src="${escapeHtml(recipe.image_url)}" alt="" loading="lazy" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105">` : ''}
        <span class="absolute top-2.5 left-2.5 px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-extrabold shadow-sm">${onOffer} av ${total} på extrapris</span>
      </a>
      <div class="p-3.5 sm:p-4 flex flex-col gap-3 flex-grow">
        <div>
          <a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener" class="text-sm sm:text-base font-bold text-zinc-900 leading-snug hover:underline">${escapeHtml(recipe.title)}</a>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] sm:text-xs text-zinc-500 font-medium">
            ${ratingHtml}
            ${meta ? `<span>${meta}</span>` : ''}
          </div>
        </div>
        <ul class="space-y-0.5">
          ${offered.map(({ ingredient, i }) => createRecipeOfferHtml(ingredient, recipeIndex, i)).join('')}
        </ul>
        ${others.length > 0 ? `
          <details class="text-xs text-zinc-600 group/details">
            <summary class="cursor-pointer select-none font-semibold text-zinc-500 hover:text-zinc-800">Övriga ingredienser (${others.length})</summary>
            <ul class="mt-1.5 space-y-0.5 pl-1">
              ${others.map(ingredient => `<li>${escapeHtml(ingredient.text)}</li>`).join('')}
            </ul>
          </details>` : ''}
        <a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener" class="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline">
          Visa receptet på ica.se
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
        </a>
      </div>
    </article>`;
}

function renderRecipeProteinPills(ranked, cheapMeatCount) {
  const container = document.getElementById('recipe-protein-pills');
  if (!container) return;
  const counts = new Map();
  for (const { recipe } of ranked) counts.set(recipe.protein, (counts.get(recipe.protein) || 0) + 1);

  const pill = (value, label, count) => {
    const active = recipes.activeProtein === value;
    return `
      <button type="button" data-recipe-protein="${escapeHtml(value)}" class="cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 flex items-center gap-1.5 ${
        active ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300'
      }">
        <span>${escapeHtml(label)}</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${active ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-100 text-zinc-600'}">${count}</span>
      </button>`;
  };
  // Turned on and off on its own, so it combines with a protein ("Kycklingfilé" under 80 kr/kg)
  const cheapActive = recipes.cheapMeat;
  const cheapMeatPill = `
    <button type="button" data-recipe-cheap-meat aria-pressed="${cheapActive}" class="cursor-pointer select-none px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-150 flex items-center gap-1.5 ${
      cheapActive ? 'bg-rose-700 text-white border-rose-700 shadow-sm' : 'bg-rose-50 text-rose-900 border-rose-200/90 hover:bg-rose-100 hover:border-rose-300'
    }">
      <span>Kött &lt;80 kr/kg</span>
      <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${cheapActive ? 'bg-rose-900 text-rose-100' : 'bg-rose-200/80 text-rose-900'}">${cheapMeatCount}</span>
    </button>
    <span class="w-px h-5 bg-zinc-200 mx-1" aria-hidden="true"></span>`;
  container.innerHTML = cheapMeatPill + pill('all', 'Alla', ranked.length) +
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([protein, count]) => pill(protein, protein, count)).join('');
}

let renderedRecipes = [];

function renderRecipes() {
  const grid = document.getElementById('recipes-grid');
  const countEl = document.getElementById('recipes-count');
  const moreBtn = document.getElementById('btn-recipes-more');
  if (!grid || !countEl || !moreBtn || !isRecipesView()) return;
  if (recipes.status === 'error') {
    countEl.textContent = 'Kunde inte hämta recepten.';
    return;
  }
  if (recipes.status !== 'loaded' || state.allOffers.length === 0) return;
  // The ingredients point at the offers by index, so both files must be from the same build
  if (recipes.offersUpdatedAt && state.updatedAt && recipes.offersUpdatedAt !== state.updatedAt) {
    countEl.textContent = 'Recepten uppdateras. Ladda om sidan om en stund.';
    grid.innerHTML = '';
    moreBtn.classList.add('hidden');
    return;
  }

  let ranked = getRankedRecipes();
  const cheapMeatCount = ranked.filter(entry => entry.cheapMeat.length > 0).length;
  if (recipes.cheapMeat) {
    // Only the meat offers under 80 kr/kg count for the protein
    ranked = ranked
      .filter(entry => entry.cheapMeat.length > 0)
      .map(entry => ({
        ...entry,
        ingredients: entry.ingredients.map(ingredient => ingredient.protein ? { ...ingredient, available: entry.cheapMeat } : ingredient)
      }));
  }
  if (recipes.activeProtein !== 'all' && !ranked.some(({ recipe }) => recipe.protein === recipes.activeProtein)) {
    recipes.activeProtein = 'all';
  }
  renderRecipeProteinPills(ranked, cheapMeatCount);

  const filtered = recipes.activeProtein === 'all' ? ranked : ranked.filter(({ recipe }) => recipe.protein === recipes.activeProtein);
  renderedRecipes = filtered.slice(0, recipes.shown);

  if (filtered.length === 0) {
    countEl.textContent = recipes.all.length === 0
      ? 'Inga recept den här veckan.'
      : recipes.cheapMeat
        ? 'Inget kött i recepten kostar under 80 kr/kg i de valda butikerna.'
        : 'Inget protein i recepten är på extrapris i de valda butikerna.';
  } else {
    countEl.innerHTML = `Visar <strong class="text-zinc-900 font-bold">${renderedRecipes.length}</strong> av ${filtered.length} recept`;
  }
  grid.innerHTML = renderedRecipes.map((entry, i) => createRecipeCardHtml(entry, i)).join('');
  moreBtn.classList.toggle('hidden', renderedRecipes.length >= filtered.length);
}

function setupRecipesView() {
  window.addEventListener('hashchange', () => {
    renderView();
    window.scrollTo({ top: 0 });
  });

  document.getElementById('recipe-protein-pills')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-recipe-cheap-meat]')) {
      recipes.cheapMeat = !recipes.cheapMeat;
    } else {
      const pill = e.target.closest('[data-recipe-protein]');
      if (!pill) return;
      recipes.activeProtein = pill.dataset.recipeProtein;
    }
    recipes.shown = RECIPES_PAGE_SIZE;
    renderRecipes();
  });

  document.getElementById('recipes-grid')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-recipe-offer]');
    if (!button) return;
    const [recipeIndex, ingredientIndex] = button.dataset.recipeOffer.split(':').map(Number);
    const ingredient = renderedRecipes[recipeIndex]?.ingredients[ingredientIndex];
    if (ingredient) openProductModal(pickIngredientOffer(ingredient.available));
  });

  document.getElementById('btn-recipes-more')?.addEventListener('click', () => {
    recipes.shown += RECIPES_PAGE_SIZE;
    renderRecipes();
  });

  document.getElementById('btn-recipes-filter')?.addEventListener('click', openMobileFilterDrawer);

  renderView();
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
  const btnToggleDesktop = document.getElementById('btn-toggle-sidebar-desktop');
  const btnCollapseDesktop = document.getElementById('btn-collapse-sidebar-desktop');

  if (btnToggleDesktop) btnToggleDesktop.addEventListener('click', () => toggleDesktopSidebar());
  if (btnCollapseDesktop) btnCollapseDesktop.addEventListener('click', () => toggleDesktopSidebar(true));

  toggleDesktopSidebar(state.sidebarCollapsed);

  const btnOpenDrawer = document.getElementById('btn-open-filter-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-filter-drawer');
  const btnApplyMobile = document.getElementById('btn-apply-filter-mobile');
  const backdrop = document.getElementById('filter-backdrop');

  if (btnOpenDrawer) btnOpenDrawer.addEventListener('click', openMobileFilterDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeMobileFilterDrawer);
  if (btnApplyMobile) btnApplyMobile.addEventListener('click', closeMobileFilterDrawer);
  if (backdrop) backdrop.addEventListener('click', closeMobileFilterDrawer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileFilterDrawer();
      closeProductModal();
    }
  });

  // Shopping List Event Listeners
  const btnOpenCart = document.getElementById('btn-open-cart');
  const btnFloatingCart = document.getElementById('btn-floating-cart');
  const btnCloseCart = document.getElementById('btn-close-cart');
  const cartBackdrop = document.getElementById('cart-backdrop');
  const btnCopyCart = document.getElementById('btn-copy-cart');
  const btnClearCart = document.getElementById('btn-clear-cart');
  const btnModalAddCart = document.getElementById('btn-modal-add-cart');

  if (btnOpenCart) btnOpenCart.addEventListener('click', () => toggleCartDrawer(true));
  if (btnFloatingCart) btnFloatingCart.addEventListener('click', () => toggleCartDrawer(true));
  if (btnCloseCart) btnCloseCart.addEventListener('click', () => toggleCartDrawer(false));
  if (cartBackdrop) cartBackdrop.addEventListener('click', () => toggleCartDrawer(false));

  if (btnCopyCart) btnCopyCart.addEventListener('click', copyCartToClipboard);
  if (btnClearCart) btnClearCart.addEventListener('click', clearCart);

  const modalCartContainer = document.getElementById('modal-cart-button-container');
  if (modalCartContainer) {
    modalCartContainer.addEventListener('click', (e) => {
      if (!state.activeModalOffer) return;
      const offer = state.activeModalOffer;

      const btnAdd = e.target.closest('#btn-modal-add-cart');
      const btnInc = e.target.closest('#btn-modal-inc-cart');
      const btnDec = e.target.closest('#btn-modal-dec-cart');

      if (btnAdd || btnInc) {
        addToCart(offer, 1, false);
      } else if (btnDec) {
        addToCart(offer, -1, false);
      }
    });
  }

  // Cart Drawer Items Delegation
  const cartContainer = document.getElementById('cart-items-container');
  if (cartContainer) {
    cartContainer.addEventListener('click', (e) => {
      const btnAction = e.target.closest('[data-action]');
      if (!btnAction) return;

      const action = btnAction.dataset.action;
      const cartId = btnAction.dataset.cartId;

      if (action === 'inc-qty') {
        updateCartItemQty(cartId, 1);
      } else if (action === 'dec-qty') {
        updateCartItemQty(cartId, -1);
      } else if (action === 'remove-item') {
        removeFromCart(cartId);
      }
    });

    cartContainer.addEventListener('change', (e) => {
      if (e.target.dataset.action === 'toggle-check') {
        const cartId = e.target.dataset.cartId;
        toggleCartItemChecked(cartId);
      }
    });
  }

  // Product Modal Event Listeners
  const btnCloseProductModal = document.getElementById('btn-close-product-modal');
  const btnCloseModalFooter = document.getElementById('btn-close-modal-footer');
  const productModalBackdrop = document.getElementById('product-modal-backdrop');
  const dealsGrid = document.getElementById('deals-grid');

  if (btnCloseProductModal) btnCloseProductModal.addEventListener('click', closeProductModal);
  if (btnCloseModalFooter) btnCloseModalFooter.addEventListener('click', closeProductModal);
  
  if (productModalBackdrop) {
    productModalBackdrop.addEventListener('click', (e) => {
      if (e.target === productModalBackdrop) {
        closeProductModal();
      }
    });
  }

  if (dealsGrid) {
    dealsGrid.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const index = parseInt(actionBtn.dataset.dealIndex, 10);
        if (!isNaN(index) && state.filteredOffers[index]) {
          const offer = state.filteredOffers[index];
          if (action === 'card-add-cart' || action === 'card-inc-cart') {
            addToCart(offer, 1);
          } else if (action === 'card-dec-cart') {
            addToCart(offer, -1);
          }
        }
        return;
      }

      const card = e.target.closest('[data-deal-index]');
      if (!card) return;
      const index = parseInt(card.dataset.dealIndex, 10);
      if (!isNaN(index) && state.filteredOffers[index]) {
        openProductModal(state.filteredOffers[index]);
      }
    });
  }

  // Veckans bästa deal: open the product, or show all deals in a group
  const bestDealSection = document.getElementById('best-deal-section');
  if (bestDealSection) {
    const openBestDeal = (target) => {
      const card = target.closest('[data-best-deal]');
      const deal = card && bestDeals[parseInt(card.dataset.bestDeal, 10)];
      if (deal) openProductModal(deal.offer);
    };

    bestDealSection.addEventListener('click', (e) => {
      const pillBtn = e.target.closest('[data-best-deal-pill]');
      if (pillBtn) {
        state.activeCategoryPill = pillBtn.dataset.bestDealPill;
        applyFilters();
        document.getElementById('category-pills-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      openBestDeal(e.target);
    });

    bestDealSection.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-best-deal]')) {
        e.preventDefault();
        openBestDeal(e.target);
      }
    });
  }

  // Category select all / deselect all in sidebar
  const btnSelectAllCats = document.getElementById('btn-select-all-cats');
  if (btnSelectAllCats) {
    btnSelectAllCats.addEventListener('click', () => {
      ALL_CATEGORIES.forEach(c => state.selectedCategories.add(c));
      state.activeCategoryPill = 'all';
      applyFilters();
    });
  }

  const btnDeselectAllCats = document.getElementById('btn-deselect-all-cats');
  if (btnDeselectAllCats) {
    btnDeselectAllCats.addEventListener('click', () => {
      state.selectedCategories.clear();
      state.activeCategoryPill = 'all';
      applyFilters();
    });
  }

  // Store filter checkboxes
  const storeCheckboxes = document.querySelectorAll('.store-filter');
  storeCheckboxes.forEach(cb => {
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
      storeCheckboxes.forEach(cb => {
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
      storeCheckboxes.forEach(cb => {
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
      storeCheckboxes.forEach(cb => {
        cb.checked = true;
        state.selectedStores.add(cb.dataset.store);
      });
      ALL_CATEGORIES.forEach(c => state.selectedCategories.add(c));
      state.activeCategoryPill = 'all';
      if (searchInput) {
        searchInput.value = '';
        if (btnClearSearch) btnClearSearch.classList.add('hidden');
      }
      state.searchQuery = '';
      state.lidlPeriod = 'this-week';
      const defaultRadio = document.querySelector('input[name="lidl-period"][value="this-week"]');
      if (defaultRadio) defaultRadio.checked = true;
      if (sortSelect) sortSelect.value = 'discount-desc';
      state.sortBy = 'discount-desc';
      applyFilters();
    });
  }
}

// --- Initialization on DOM Load ---
document.addEventListener('DOMContentLoaded', () => {
  state.cart = loadCartFromStorage();
  setupEventListeners();
  setupFacebookSection();
  setupRecipesView();
  fetchDealsData();
  fetchFacebookPosts();
  updateCartUI();
});
