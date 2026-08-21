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
  'Fisk & Skaldjur',
  'Mejeri & Ägg',
  'Frukt & Grönt',
  'Bröd & Bageri',
  'Skafferi',
  'Snacks & Godis',
  'Dryck',
  'Frys & Färdigmat',
  'Hushåll & Hygien',
  'Övrigt'
];

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

  // Lidl (#00509E)
  'Lidl': { bg: '#00509E', text: '#FFFFFF' }
};

const DEFAULT_IMG = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80";

// Categorization helper for frontend
function categorizeOfferJS(offer) {
  if (offer.category && ALL_CATEGORIES.includes(offer.category) && offer.category !== 'Övrigt') {
    return offer.category;
  }

  const text = `${offer.product || ''} ${offer.brand || ''} ${offer.description || ''}`.toLowerCase();
  const rawCat = (offer.category || '').toLowerCase();
  
  // 1. Hushåll & Hygien / Djurmat (FIRST priority)
  if (/hundmat|kattmat|\bhund\b|\bkatt\b|kattsand|pedigree|whiskas|latz|dentasticks|tvättmedel|tvättkapslar|sköljmedel|rengöring|schampo|shampoo|tvål|handtvål|duschtvål|duschgel|duschcreme|blöjor|blöjpåse|toalettpapper|hushållspapper|tandkräm|diskmedel|fryspåsar|plastpåsar|avfallspåsar|sopsäck|hundbajspåse|deodorant|deo|balsam|lotion|hudkräm|hårfärg|multivitamin|omega 3|vitamin|magnesium|kreatin|creatine|gummies|listerine|munskölj|städservetter|diskborste|disksvamp|diskduk|servetter|hälsa & skönhet|tandborste|tandborsthuvud|värmeljus|rakhyvel|ansiktsmask|bindor|trosskydd|intimtvätt|libresse|batterier|batteri|plastfolie|folie|pappmugg|hink|mopp|tvättlappar|maskindisktabletter/i.test(text)) {
    return 'Hushåll & Hygien';
  }

  // 2. Frukt & Grönt (BEFORE meat to prevent färskpotatis / färsk majskolv becoming meat)
  if (/frukt|grönsak|grönsaker|grönt|bär|äpple|äpplen|banan|bananer|potatis|färskpotatis|tomat|tomater|gurka|gurkor|sallad|lök|morot|morötter|majs|majskolv|avokado|melon|citron|citroner|apelsin|apelsiner|druvor|jordgubb|hallon|blåbär|paprika|vitlök|champinjon|svamp|clementin|satsumas|nektarin|persika|plommon|kiwi|kolv|broccoli|blomkål|spenat|rotfrukter|sparris|purjolök|ruccola|basilika|persilja|dill|krasse|selleri|palsternacka|rödbetor|kål|vitkål|rödkål|grönkål|lime|ingefära|chili|mango|ananas|päron|vindruvor|grapefrukt|småbladsmix|kronärtskocka|sharon|kaki|granatäpple|solrosor|blommor|bukett|krysantemum|växt|krukväxt/i.test(text)) {
    return 'Frukt & Grönt';
  }

  // 3. Skafferi / Snacks (BEFORE mejeri/kött to catch jordnötssmör/nötter)
  if (/jordnötssmör|nötssmör|pasta|ris|basmati|jasminris|risotto|mjöl|socker|olja|vinäger|kaffe|te|sås|ketchup|senap|konserv|linser|bönor|krydda|kryddor|buljong|müsli|musli|granola|cheerios|frosties|cornflakes|havreringar|cereal|flingor|havregryn|pesto|taco|tacos|spaghetti|macaroni|makaroner|matolja|rapsolja|olivolja|majonnäs|mayo|sylt|marmelad|honung|gevalia|zoegas|arvid nordquist|löfbergs|nescafé|nesquik|nudlar|couscous|bulgur|dressing|marinad|salsa|tomatkross|passerade tomater|kokosmjölk|cornichons|oliver|kapris|barnmat|välling|gröt|sirap|ströbröd|tofu|hummus|\bfond\b|\bsoja\b|lasagne|grytbas/i.test(text)) {
    if (/chips|godis|choklad|popcorn|kex|ostbågar|ostkrokar|lakrits|tuggummi|marabou|estrella|olw|cloetta|haribo|cheez|snacks|wafer|proteinbar|corny|lösgodis|kexchoklad|daim|twix|snickers|mars|bounty|dumle|geisha|alesto|nutella|halva|delicatoboll|läkerol|halstabletter|fisherman|mentos|gott & blandat|gott och blandat|gott&blandat|malaco/i.test(text)) {
      return 'Snacks & Godis';
    }
    return 'Skafferi';
  }

  // 4. Bröd & Bageri (BEFORE meat to prevent korvbröd/hamburgerbröd becoming meat)
  if (/korvbröd|hamburgerbröd|bröd|kaka|kakor|bulle|bullar|tårta|knäcke|knäckebröd|fralla|frallor|pita|pitabröd|tortilla|toast|croissant|limpa|pågen|pågens|fazer|skogaholm|våffl|donut|donuts|muffin|muffins|bagel|wienerbröd|kanelbulle|vaniljbulle|semla|kladdkaka|surdeg|rågbröd|lingongrova|hönökaka|vetekaka|tekaka|fullkornsbröd|småbröd|polarbröd|polarkaka|formbröd|formfranska|rostbröd|scones|bageri|pinsa|panini|mellangrova/i.test(text)) {
    return 'Bröd & Bageri';
  }

  // 5. Frys & Färdigmat (BEFORE meat to prevent ready meals 'thaibox kyckling' becoming raw meat)
  if (/thaibox|thaiboxar|enportionsrätter|enportionsrätt|färdigrätt|färdigrätter|matlåda|matlådor|vårrullar|pytt|pizza|pizzor|kebabpizza|pirog|gorbys|billys|dafgård|felix|findus|gooh|nuggets|pommes|glass|gb glace|triumf|paj/i.test(text)) {
    return 'Frys & Färdigmat';
  }

  // 6. Kött & Fågel
  if (/\b(kött|färs|kyckling|fläsk|nötkött|korv|korvar|bacon|skinka|karré|karre|kotlett|entrecote|entrecôte|biff|lövbiff|rostbiff|kalkon|lever|chark|salami|medwurst|medwurt|pulled pork|ribs|revbensspjäll|lamm|späck|charkuterier|leverpastej|falukorv|grillkorv|wienerkorv|varmkorv|ölkorv|blodpudding|sylta|oxfilé|fläskfilé|högrev|fransyska|schnitzel|kassler|fläskytterfilé|kebab|grytbitar|chorizo|cabanoss|prinskorv|smörgåspålägg|prosciutto|jamon|mortadella|pasteta|paté|pate|fläskbog|fläsklägg|grillkarré|flapsteak|spickekött|fuet|nöt|ox|bog|lägg|bringa|grillskiva|grillskivor|grillkött)\b/i.test(text)) {
    return 'Kött & Fågel';
  }

  // 7. Fisk & Skaldjur
  if (/\b(fisk|lax|torsk|räkor|räka|sill|makrill|tunnfisk|tuna|tonfisk|kräftor|kräfta|sej|spätta|musslor|skaldjur|lutfisk|rom|fiskpinnar|fiskkaka|fiskgratäng|surströmming|hummer|krabba|fiskfilé|panerad fisk|bläckfisk|scampi|laxfilé|torskfilé|sejfilé|röding|öring|caviar|kaviar|tångcaviar)\b/i.test(text)) {
    return 'Fisk & Skaldjur';
  }

  // 8. Mejeri & Ägg
  if (/mjölk|grädde|smör|ost|ostar|margarin|yoggi|yoghurt|fil|filmjölk|kvarg|ägg|crème fraiche|creme fraiche|fraiche|keso|halloumi|norrloumi|mozzarella|vispgrädde|matlagningsgrädde|bregott|flora|lätta|kesella|gräddfil|ricotta|feta|vitost|brie|camembert|parmesan|parmigiano|gouda|hushållsost|prästost|herrgård|grevé|svecia|västerbottensost|gräddost|havredryck|mandeldryck|sojadryck|oatly|yalla|actimel|danonino|skyr|hamburgerost|smältost|mjukost|skivost|rivost|proteinshake/i.test(text)) {
    return 'Mejeri & Ägg';
  }

  // 9. Dryck
  if (/läsk|saft|vatten|juice|energidryck|öl|cider|alkoholfri|must|coca-cola|coca cola|cola|pepsi|fanta|sprite|nocco|celsius|red bull|ramlösa|loka|monster|tonic|iskaffe|smoothie|kombucha|dricka|måltidsdryck|lättöl|festis|tropicana|god morgon|brämhults|trocadero|pucko|zingo|7up|powerade|gainomax|proteindryck|fun light|nyponsoppa|fruktdryck|matlagningsvin|peroni|dr pepper|pepper|dryck|nåbe|aloe vera|aloe/i.test(text)) {
    return 'Dryck';
  }

  // 10. Skafferi
  if (/pasta|ris|basmati|jasminris|risotto|mjöl|socker|olja|vinäger|kaffe|te|sås|ketchup|senap|konserv|linser|bönor|krydda|kryddor|buljong|müsli|musli|granola|cheerios|frosties|cornflakes|havreringar|cereal|flingor|havregryn|pesto|taco|tacos|spaghetti|macaroni|makaroner|matolja|rapsolja|olivolja|majonnäs|mayo|sylt|marmelad|honung|gevalia|zoegas|arvid nordquist|löfbergs|nescafé|nesquik|nudlar|couscous|bulgur|dressing|marinad|salsa|tomatkross|passerade tomater|kokosmjölk|cornichons|oliver|kapris|barnmat|välling|gröt|sirap|ströbröd|tofu|hummus|\bfond\b|\bsoja\b|lasagne|grytbas/i.test(text)) {
    return 'Skafferi';
  }

  if (rawCat.includes('frukt') || rawCat.includes('grönt')) return 'Frukt & Grönt';
  if (rawCat.includes('mejeri')) return 'Mejeri & Ägg';
  if (rawCat.includes('bröd') || rawCat.includes('bageri')) return 'Bröd & Bageri';
  if (rawCat.includes('kött') || rawCat.includes('chark')) return 'Kött & Fågel';
  if (rawCat.includes('fisk') || rawCat.includes('skaldjur')) return 'Fisk & Skaldjur';
  if (rawCat.includes('dryck')) return 'Dryck';
  if (rawCat.includes('snacks') || rawCat.includes('godis')) return 'Snacks & Godis';
  if (rawCat.includes('djupfryst') || rawCat.includes('fryst')) return 'Frys & Färdigmat';
  if (rawCat.includes('färskvaror')) return 'Kött & Fågel';

  return 'Övrigt';
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

// --- Helper for Kött & Fågel < 80 kr/kg Filter ---
function isMeatUnder80PerKg(offer) {
  const cat = offer.category || categorizeOfferJS(offer);
  if (cat !== 'Kött & Fågel') return false;

  const { pricePerUnit, isExplicitPerKg } = extractPerUnitDealPriceJS(offer.price);
  if (pricePerUnit <= 0) return false;

  // Case 1: Explicit per kg price string (e.g. "64,90/kg", "79,90 kr/kg")
  if (isExplicitPerKg) {
    return pricePerUnit <= 80.0;
  }

  // Case 2: Calculate exact price per kg from package weight
  const textForWeight = `${offer.product || ''} ${offer.description || ''}`;
  const weightKg = extractPackageWeightInKgJS(textForWeight);

  if (weightKg > 0) {
    const calculatedPricePerKg = pricePerUnit / weightKg;
    return calculatedPricePerKg <= 80.0;
  }

  return false;
}

// Compute Category Counts based on active store filter
function computeCategoryCounts() {
  state.categoryCounts = {};
  for (const cat of ALL_CATEGORIES) {
    state.categoryCounts[cat] = 0;
  }
  state.categoryCounts['Kött & Fågel <80 kr/kg'] = 0;

  for (const offer of state.allOffers) {
    const store = (offer.store || '').trim();
    const isStoreSelected = store === 'Lidl' 
      ? state.selectedStores.has('Lidl') 
      : state.selectedStores.has(store);
    
    if (!isStoreSelected) continue;

    const cat = offer.category || categorizeOfferJS(offer);
    state.categoryCounts[cat] = (state.categoryCounts[cat] || 0) + 1;

    if (isMeatUnder80PerKg(offer)) {
      state.categoryCounts['Kött & Fågel <80 kr/kg']++;
    }
  }
}

// Render horizontal Category Quick-Filter Pills
function renderCategoryPills() {
  const container = document.getElementById('category-pills-container');
  if (!container) return;

  const totalStoreOffers = Object.values(state.categoryCounts).reduce((a, b) => a + b, 0);

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
      if (meatUnder80Count > 0) {
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

  // 3. Filter by Category
  result = result.filter(offer => {
    if (state.activeCategoryPill === 'Kött & Fågel <80 kr/kg') {
      return isMeatUnder80PerKg(offer);
    }
    const cat = offer.category || categorizeOfferJS(offer);
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
  renderCategoryPills();
  renderCategoryCheckboxes();
  renderDeals();
  renderResultsCount();
  updateMobileFilterBadge();

  // 7. Willys Reference Prices
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

// --- Willys Reference Box Logic ---
const willysSearchCache = new Map();
let currentWillysSearchToken = 0;

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

  const localMatches = getLocalWillysMatches(q);
  if (localMatches.length > 0) {
    renderReferenceBox(localMatches, q);
  }

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
function createDealCardHtml(offer, index) {
  const store = (offer.store || 'Okänd butik').trim();
  const shortStore = getShortStoreName(store);
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('ica') ? '#E21936' : (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563'));
  
  const cat = offer.category || categorizeOfferJS(offer);
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

  return `
    <div data-deal-index="${index}" class="deal-card cursor-pointer group bg-white rounded-xl sm:rounded-2xl border border-zinc-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-200 flex flex-col h-[290px] sm:h-[360px] md:h-[400px] relative overflow-hidden">
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
  if (countEl) {
    countEl.innerHTML = `Visar <strong class="text-zinc-900 font-bold">${state.filteredOffers.length}</strong> aktuella erbjudanden`;
  }
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
async function renderModalWillysReference(productName) {
  const refBox = document.getElementById('modal-willys-ref-box');
  const refItemsContainer = document.getElementById('modal-willys-ref-items');
  if (!refBox || !refItemsContainer) return;

  refBox.classList.add('hidden');
  refItemsContainer.innerHTML = '';

  if (!productName) return;

  // 1. Check local dataset with strict relevance score
  let matches = getLocalWillysMatches(productName);

  // 2. If no local match, query Willys API using core keywords (e.g. "majskolv")
  if (matches.length === 0) {
    const coreTokens = extractCoreKeywords(productName);
    const searchPhrase = coreTokens.join(' ');

    if (searchPhrase && searchPhrase.length >= 2) {
      try {
        const apiResults = await fetchWillysReferenceItems(searchPhrase);
        if (apiResults && apiResults.length > 0) {
          const scored = [];
          const seen = new Set();

          for (const item of apiResults) {
            const itemProd = (item.product || '').toLowerCase();
            let score = 0;

            if (itemProd === productName.toLowerCase()) {
              score = 100;
            } else if (itemProd.includes(searchPhrase)) {
              score = 60;
            } else if (coreTokens.every(t => itemProd.includes(t))) {
              score = 50;
            } else if (coreTokens.some(t => t.length >= 4 && itemProd.includes(t))) {
              score = 25;
            }

            if (score >= 20) {
              const key = item.product.toLowerCase();
              if (!seen.has(key)) {
                seen.add(key);
                scored.push({ item, score });
              }
            }
          }

          scored.sort((a, b) => b.score - a.score);
          matches = scored.map(s => s.item);
        }
      } catch (err) {
        console.warn('Modal Willys API reference search error:', err);
      }
    }
  }

  // 3. Render only if relevant matches exist
  if (matches && matches.length > 0) {
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

function openProductModal(offer) {
  const backdrop = document.getElementById('product-modal-backdrop');
  const modal = document.getElementById('product-modal');
  if (!backdrop || !modal) return;

  const store = (offer.store || 'Okänd butik').trim();
  const storeBadgeColor = STORE_COLORS[store]?.bg || (store.toLowerCase().includes('ica') ? '#E21936' : (store.toLowerCase().includes('hemköp') ? '#D31115' : '#4B5563'));
  const cat = offer.category || categorizeOfferJS(offer);
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

  const parsedDealPrice = parsePriceNumeric(priceText);
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
    savingsEl.textContent = `Du sparar ${savingsSek.toString().replace('.', ',')} kr!`;
    savingsEl.classList.remove('hidden');
  } else if (savingsEl) {
    savingsEl.classList.add('hidden');
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

  // Willys Reference Price Box inside Modal (Async & strict score matching)
  renderModalWillysReference(productName);

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
      const card = e.target.closest('[data-deal-index]');
      if (!card) return;
      const index = parseInt(card.dataset.dealIndex, 10);
      if (!isNaN(index) && state.filteredOffers[index]) {
        openProductModal(state.filteredOffers[index]);
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
  setupEventListeners();
  fetchDealsData();
});
