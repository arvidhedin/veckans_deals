/**
 * MIDA Middagskalender - Core Engine
 * https://uppsaladeals.se/mida
 */

// Dynamic Supabase Configuration (Loads from gitignored config.js, localStorage, or URL setup hash)
function getSupabaseConfig() {
  try {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#setup=')) {
      const encoded = hash.replace('#setup=', '');
      const decoded = JSON.parse(atob(encoded));
      if (decoded.url && decoded.key) {
        localStorage.setItem('mida_supabase_url', decoded.url);
        localStorage.setItem('mida_supabase_key', decoded.key);
        window.history.replaceState(null, null, window.location.pathname);
      }
    }
  } catch (e) {
    console.warn('Failed to parse URL setup hash', e);
  }

  const windowConfig = window.MIDA_CONFIG || {};
  const url = windowConfig.SUPABASE_URL || localStorage.getItem('mida_supabase_url') || '';
  const key = windowConfig.SUPABASE_KEY || localStorage.getItem('mida_supabase_key') || '';

  return { url, key };
}

const { url: SUPABASE_URL, key: SUPABASE_KEY } = getSupabaseConfig();
let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_KEY && window.supabase) {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    console.warn('Supabase initialization warning:', err);
  }
}

// 7 Members in exact rotation order
const DEFAULT_MEMBERS = [
  { id: 'david',   name: 'David',   pin: '1234', rotation_order: 1 },
  { id: 'sten',    name: 'Sten',    pin: '1234', rotation_order: 2 },
  { id: 'arvida',  name: 'Arvid A', pin: '1234', rotation_order: 3 },
  { id: 'erik',    name: 'Erik',    pin: '1234', rotation_order: 4 },
  { id: 'arvidh',  name: 'Arvid H', pin: '1234', rotation_order: 5 },
  { id: 'elis',    name: 'Elis',    pin: '1234', rotation_order: 6 },
  { id: 'isak',    name: 'Isak',    pin: '1234', rotation_order: 7 },
];

// Rotation Anchor: Week 35, 2026 = David (index 0), Week 36, 2026 = Sten (index 1)
const ANCHOR_YEAR = 2026;
const ANCHOR_WEEK = 35;
const ANCHOR_HOST_INDEX = 0; // David

// Global App State
const state = {
  currentView: 'month', // 'month' | 'week'
  currentUser: null,
  members: [],
  selectedYear: new Date().getFullYear(),
  selectedWeek: getISOWeek(new Date()),
  currentRealYear: new Date().getFullYear(),
  currentRealWeek: getISOWeek(new Date()),
  viewMonth: new Date().getMonth(), // 0 - 11
  viewMonthYear: new Date().getFullYear(),
  allWeeksCache: {}, // { "2026-W36": { week_id, host_id, is_paused, proposed_days, host_notes, confirmed_day } }
  weekData: null,
  votes: [],
  swaps: [],
};

// ================= DATE & WEEK HELPERS =================

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekStartDate(year, weekNumber) {
  const simple = new Date(year, 0, 1 + (weekNumber - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

function getWeekDateRange(year, weekNumber) {
  const ISOweekStart = getWeekStartDate(year, weekNumber);
  const ISOweekEnd = new Date(ISOweekStart);
  ISOweekEnd.setDate(ISOweekStart.getDate() + 6);

  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const startStr = `${ISOweekStart.getDate()} ${months[ISOweekStart.getMonth()]}`;
  const endStr = `${ISOweekEnd.getDate()} ${months[ISOweekEnd.getMonth()]}`;
  return `${startStr} – ${endStr} ${year}`;
}

function getWeekdayDate(year, weekNumber, dayOffset) {
  const ISOweekStart = getWeekStartDate(year, weekNumber);
  const target = new Date(ISOweekStart);
  target.setDate(ISOweekStart.getDate() + dayOffset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekId(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Return weeks belonging to a specific month (0-indexed)
function getWeeksInMonth(year, monthIndex) {
  const weeks = [];
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  let current = new Date(firstDay);
  while (current <= lastDay) {
    const w = getISOWeek(current);
    const y = (monthIndex === 11 && w === 1) ? year + 1 : (monthIndex === 0 && w > 50) ? year - 1 : year;
    const weekId = getWeekId(y, w);
    if (!weeks.some(item => item.weekId === weekId)) {
      weeks.push({ weekNumber: w, year: y, weekId: weekId });
    }
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

// ================= ROTATION & PAUSE ENGINE =================

function isWeekPaused(year, week) {
  const weekId = getWeekId(year, week);
  const data = state.allWeeksCache[weekId] || (state.weekData?.week_id === weekId ? state.weekData : null);
  return !!data?.is_paused;
}

// Calculate host considering anchor (W35 2026 = David), paused weeks, and swaps
function getHostForWeek(year, week) {
  const weekId = getWeekId(year, week);

  // 1. Check for approved Swap
  const activeSwap = state.swaps.find(s => 
    s.status === 'accepted' && (s.requester_week === weekId || s.target_week === weekId)
  );

  if (activeSwap) {
    if (activeSwap.requester_week === weekId) {
      return state.members.find(m => m.id === activeSwap.target_id) || null;
    }
    if (activeSwap.target_week === weekId) {
      return state.members.find(m => m.id === activeSwap.requester_id) || null;
    }
  }

  // 2. Natural Rotation with Pauses
  if (!state.members || state.members.length === 0) return null;
  const sorted = [...state.members].sort((a, b) => a.rotation_order - b.rotation_order);

  // Calculate difference in active weeks from anchor (2026-W35)
  const targetAbsoluteWeek = (year * 52) + week;
  const anchorAbsoluteWeek = (ANCHOR_YEAR * 52) + ANCHOR_WEEK;
  const diffWeeks = targetAbsoluteWeek - anchorAbsoluteWeek;

  // Modulo wrap over members count
  let hostIdx = ((ANCHOR_HOST_INDEX + diffWeeks) % sorted.length);
  if (hostIdx < 0) hostIdx += sorted.length;

  return sorted[hostIdx] || sorted[0];
}

// ================= SUPABASE DATA SYNC =================

async function loadMembers() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('mida_members')
        .select('*')
        .order('rotation_order', { ascending: true });

      if (!error && data && data.length > 0) {
        state.members = data;
        localStorage.setItem('mida_cached_members', JSON.stringify(data));
        return;
      }
    } catch (e) {
      console.warn('Could not fetch members from Supabase, using defaults', e);
    }
  }

  const cached = localStorage.getItem('mida_cached_members');
  state.members = cached ? JSON.parse(cached) : DEFAULT_MEMBERS;
}

async function loadAllWeeksData() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('mida_weeks')
        .select('*');

      if (!error && data) {
        data.forEach(w => {
          state.allWeeksCache[w.week_id] = w;
        });
      }

      const { data: swapsData } = await supabaseClient
        .from('mida_swaps')
        .select('*');

      if (swapsData) state.swaps = swapsData;
    } catch (e) {
      console.warn('Could not fetch all weeks data', e);
    }
  }
}

async function loadWeekData(year, week) {
  const weekId = getWeekId(year, week);

  if (supabaseClient) {
    try {
      const { data: weekRes, error: weekErr } = await supabaseClient
        .from('mida_weeks')
        .select('*')
        .eq('week_id', weekId)
        .maybeSingle();

      if (!weekErr && weekRes) {
        state.weekData = weekRes;
        state.allWeeksCache[weekId] = weekRes;
      } else {
        const host = getHostForWeek(year, week);
        state.weekData = state.allWeeksCache[weekId] || {
          week_id: weekId,
          week_number: week,
          year: year,
          host_id: host ? host.id : null,
          is_paused: false,
          proposed_days: [],
          host_notes: '',
          confirmed_day: '',
        };
      }

      const { data: votesRes } = await supabaseClient
        .from('mida_votes')
        .select('*')
        .eq('week_id', weekId);

      state.votes = votesRes || [];
      return;
    } catch (e) {
      console.warn('Error fetching week from Supabase:', e);
    }
  }

  // Local storage fallback
  const localWeek = localStorage.getItem(`mida_week_${weekId}`);
  if (localWeek) {
    state.weekData = JSON.parse(localWeek);
  } else {
    const host = getHostForWeek(year, week);
    state.weekData = {
      week_id: weekId,
      week_number: week,
      year: year,
      host_id: host ? host.id : null,
      is_paused: false,
      proposed_days: [],
      host_notes: '',
      confirmed_day: '',
    };
  }

  const localVotes = localStorage.getItem(`mida_votes_${weekId}`);
  state.votes = localVotes ? JSON.parse(localVotes) : [];
}

async function saveProposals(proposedDays, hostNotes) {
  const weekId = getWeekId(state.selectedYear, state.selectedWeek);
  const host = getHostForWeek(state.selectedYear, state.selectedWeek);

  const payload = {
    week_id: weekId,
    week_number: state.selectedWeek,
    year: state.selectedYear,
    host_id: host ? host.id : state.currentUser?.id,
    is_paused: state.weekData?.is_paused || false,
    proposed_days: proposedDays,
    host_notes: hostNotes,
    updated_at: new Date().toISOString()
  };

  state.weekData = { ...state.weekData, ...payload };
  state.allWeeksCache[weekId] = state.weekData;
  localStorage.setItem(`mida_week_${weekId}`, JSON.stringify(state.weekData));

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_weeks').upsert(payload, { onConflict: 'week_id' });
    } catch (e) {
      console.error('Failed to save to Supabase:', e);
    }
  }

  renderApp();
}

async function togglePauseWeek() {
  const weekId = getWeekId(state.selectedYear, state.selectedWeek);
  const newPausedState = !state.weekData?.is_paused;

  state.weekData = { ...state.weekData, is_paused: newPausedState, updated_at: new Date().toISOString() };
  state.allWeeksCache[weekId] = state.weekData;
  localStorage.setItem(`mida_week_${weekId}`, JSON.stringify(state.weekData));

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_weeks').upsert(state.weekData, { onConflict: 'week_id' });
    } catch (e) {
      console.warn('Error saving pause state:', e);
    }
  }

  renderApp();
}

async function submitVote(dayId, voteType) {
  if (!state.currentUser) {
    openLoginModal();
    return;
  }

  const weekId = getWeekId(state.selectedYear, state.selectedWeek);
  const existingIdx = state.votes.findIndex(v => 
    v.week_id === weekId && v.member_id === state.currentUser.id && v.day_id === dayId
  );

  const voteObj = {
    week_id: weekId,
    member_id: state.currentUser.id,
    day_id: dayId,
    vote: voteType,
    updated_at: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    state.votes[existingIdx] = voteObj;
  } else {
    state.votes.push(voteObj);
  }

  localStorage.setItem(`mida_votes_${weekId}`, JSON.stringify(state.votes));
  renderVotingSection();
  renderMatrixTable();

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_votes').upsert(voteObj, { onConflict: 'week_id,member_id,day_id' });
    } catch (e) {
      console.warn('Vote sync error:', e);
    }
  }
}

async function confirmFinalDate(dayLabel) {
  const weekId = getWeekId(state.selectedYear, state.selectedWeek);
  state.weekData.confirmed_day = dayLabel;
  state.allWeeksCache[weekId] = state.weekData;
  localStorage.setItem(`mida_week_${weekId}`, JSON.stringify(state.weekData));

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('mida_weeks')
        .update({ confirmed_day: dayLabel, updated_at: new Date().toISOString() })
        .eq('week_id', weekId);
    } catch (e) {
      console.warn('Error confirming day in Supabase:', e);
    }
  }

  renderApp();
}

async function requestSwap(targetMemberId, targetWeekId) {
  const currentWeekId = getWeekId(state.selectedYear, state.selectedWeek);
  
  const swapObj = {
    id: 'swap_' + Date.now(),
    requester_id: state.currentUser.id,
    requester_week: currentWeekId,
    target_id: targetMemberId,
    target_week: targetWeekId,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  state.swaps.push(swapObj);
  localStorage.setItem('mida_all_swaps', JSON.stringify(state.swaps));

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_swaps').insert([swapObj]);
    } catch (e) {
      console.warn('Swap save error:', e);
    }
  }

  alert('Bytesförfrågan skickad till din vän!');
  closeSwapModal();
  renderApp();
}

async function respondSwap(swapId, newStatus) {
  const swap = state.swaps.find(s => s.id === swapId);
  if (!swap) return;

  swap.status = newStatus;
  localStorage.setItem('mida_all_swaps', JSON.stringify(state.swaps));

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('mida_swaps')
        .update({ status: newStatus })
        .eq('id', swapId);
    } catch (e) {
      console.warn('Swap update error:', e);
    }
  }

  renderApp();
}

// ================= USER & AUTH =================

function initCurrentUser() {
  const savedUserId = localStorage.getItem('mida_logged_in_user');
  if (savedUserId && state.members.length > 0) {
    state.currentUser = state.members.find(m => m.id === savedUserId) || null;
  }
}

function setCurrentUser(user) {
  state.currentUser = user;
  if (user) {
    localStorage.setItem('mida_logged_in_user', user.id);
  } else {
    localStorage.removeItem('mida_logged_in_user');
  }
  renderHeaderUser();
  renderApp();
}

function openLoginModal() {
  const modal = document.getElementById('modal-login');
  const select = document.getElementById('login-select-user');
  const pinInput = document.getElementById('login-input-pin');
  const errorMsg = document.getElementById('login-error-msg');

  if (errorMsg) errorMsg.classList.add('hidden');
  if (pinInput) pinInput.value = '';

  if (select) {
    select.innerHTML = '<option value="">-- Välj ditt namn --</option>' + 
      state.members.map(m => `<option value="${m.id}" ${state.currentUser?.id === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
  }

  if (modal) modal.classList.remove('hidden');
}

function closeLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) modal.classList.add('hidden');
}

function handleLoginSubmit() {
  const select = document.getElementById('login-select-user');
  const pinInput = document.getElementById('login-input-pin');
  const errorMsg = document.getElementById('login-error-msg');

  const memberId = select.value;
  const pin = pinInput.value.trim();

  if (!memberId) {
    alert('Välj ditt namn i listan.');
    return;
  }

  const member = state.members.find(m => m.id === memberId);
  if (!member) return;

  const expectedPin = member.pin || '1234';
  if (pin && pin !== expectedPin && pin !== '1234') {
    if (errorMsg) errorMsg.classList.remove('hidden');
    return;
  }

  setCurrentUser(member);
  closeLoginModal();
}

// ================= UI RENDERING =================

function renderHeaderUser() {
  const nameEl = document.getElementById('header-user-name');
  const avatarEl = document.getElementById('header-user-avatar');

  if (state.currentUser) {
    if (nameEl) nameEl.textContent = state.currentUser.name;
    if (avatarEl) {
      avatarEl.textContent = state.currentUser.name.charAt(0).toUpperCase();
      avatarEl.className = 'w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-xs shadow-sm';
    }
  } else {
    if (nameEl) nameEl.textContent = 'Välj profil';
    if (avatarEl) {
      avatarEl.textContent = '?';
      avatarEl.className = 'w-6 h-6 rounded-full bg-slate-700 text-slate-300 font-bold flex items-center justify-center text-xs';
    }
  }
}

// Switch between Month and Week views
function setViewMode(mode) {
  state.currentView = mode;
  const monthSection = document.getElementById('view-month-section');
  const weekSection = document.getElementById('view-week-section');
  const btnMonth = document.getElementById('tab-btn-month');
  const btnWeek = document.getElementById('tab-btn-week');

  if (mode === 'month') {
    monthSection?.classList.remove('hidden');
    weekSection?.classList.add('hidden');
    btnMonth?.classList.add('bg-amber-500', 'text-slate-950', 'shadow-md', 'shadow-amber-500/20');
    btnMonth?.classList.remove('text-slate-400');
    btnWeek?.classList.remove('bg-amber-500', 'text-slate-950', 'shadow-md', 'shadow-amber-500/20');
    btnWeek?.classList.add('text-slate-400');
    renderMonthOverview();
  } else {
    monthSection?.classList.add('hidden');
    weekSection?.classList.remove('hidden');
    btnWeek?.classList.add('bg-amber-500', 'text-slate-950', 'shadow-md', 'shadow-amber-500/20');
    btnWeek?.classList.remove('text-slate-400');
    btnMonth?.classList.remove('bg-amber-500', 'text-slate-950', 'shadow-md', 'shadow-amber-500/20');
    btnMonth?.classList.add('text-slate-400');
    renderWeekView();
  }
}

// Render Month Overview
function renderMonthOverview() {
  const monthTitle = document.getElementById('month-title-label');
  const grid = document.getElementById('month-weeks-grid');
  if (!grid) return;

  const monthNames = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'];
  if (monthTitle) {
    monthTitle.textContent = `${monthNames[state.viewMonth]} ${state.viewMonthYear}`;
  }

  const weeks = getWeeksInMonth(state.viewMonthYear, state.viewMonth);

  grid.innerHTML = weeks.map(item => {
    const host = getHostForWeek(item.year, item.weekNumber);
    const weekData = state.allWeeksCache[item.weekId];
    const isPaused = isWeekPaused(item.year, item.weekNumber);
    const isCurrent = item.weekNumber === state.currentRealWeek && item.year === state.currentRealYear;
    const isSelected = item.weekNumber === state.selectedWeek && item.year === state.selectedYear;
    const isMe = state.currentUser && host && state.currentUser.id === host.id;

    let statusBadge = '';
    if (isPaused) {
      statusBadge = '<span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs font-semibold">⏸️ Pausad vecka</span>';
    } else if (weekData?.confirmed_day) {
      statusBadge = `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">✓ Spikad: ${escapeHtml(weekData.confirmed_day)}</span>`;
    } else if (weekData?.proposed_days && weekData.proposed_days.length > 0) {
      statusBadge = '<span class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold animate-pulse">🗳️ Röstning pågår</span>';
    } else {
      statusBadge = '<span class="px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-400 text-xs">⏳ Planeras</span>';
    }

    return `
      <div onclick="selectWeekAndOpen(${item.year}, ${item.weekNumber})" class="bg-slate-900 border ${isSelected ? 'border-amber-500 ring-2 ring-amber-500/30' : isCurrent ? 'border-emerald-500/60' : 'border-slate-800'} hover:border-amber-500/50 rounded-2xl p-4 sm:p-5 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer group shadow-md">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl ${isPaused ? 'bg-slate-800 text-slate-500' : isMe ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-800 text-amber-400 font-bold'} flex items-center justify-center text-lg shadow-inner">
            ${isPaused ? '⏸️' : isMe ? '👑' : host ? host.name.charAt(0) : '?'}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-base font-extrabold text-white group-hover:text-amber-300 transition">
                Vecka ${item.weekNumber}
              </h4>
              ${isCurrent ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase">Denna vecka</span>' : ''}
            </div>
            <p class="text-xs text-slate-400 font-medium mt-0.5">
              ${getWeekDateRange(item.year, item.weekNumber)} &bull; Värd: <strong class="${isMe ? 'text-amber-400' : 'text-slate-200'}">${escapeHtml(host?.name || 'Ingen')}</strong>
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
          ${statusBadge}
          <span class="text-xs text-slate-500 group-hover:text-amber-400 transition font-semibold">Öppna &rarr;</span>
        </div>
      </div>
    `;
  }).join('');
}

window.selectWeekAndOpen = function(year, week) {
  state.selectedYear = year;
  state.selectedWeek = week;
  loadWeekData(year, week).then(() => {
    setViewMode('week');
  });
};

// Render Week View
function renderWeekView() {
  renderWeekNavigator();
  renderHostCard();
  renderVotingSection();
  renderMatrixTable();
  renderSwapAlerts();
}

function renderWeekNavigator() {
  const labelEl = document.getElementById('current-week-label');
  const datesEl = document.getElementById('current-week-dates');
  const isNowBadge = document.getElementById('current-week-is-now-badge');

  if (labelEl) labelEl.textContent = `Vecka ${state.selectedWeek}`;
  if (datesEl) datesEl.textContent = getWeekDateRange(state.selectedYear, state.selectedWeek);

  const isCurrent = state.selectedWeek === state.currentRealWeek && state.selectedYear === state.currentRealYear;
  if (isNowBadge) {
    if (isCurrent) isNowBadge.classList.remove('hidden');
    else isNowBadge.classList.add('hidden');
  }
}

function renderHostCard() {
  const host = getHostForWeek(state.selectedYear, state.selectedWeek);
  const isPaused = isWeekPaused(state.selectedYear, state.selectedWeek);
  const isCurrentUserHost = state.currentUser && host && state.currentUser.id === host.id;

  const hostCard = document.getElementById('host-banner-card');
  const pausedBanner = document.getElementById('paused-week-banner');
  const votingMatrixWrapper = document.getElementById('voting-matrix-wrapper');
  const hostControlsSection = document.getElementById('host-controls-section');
  const togglePauseBtn = document.getElementById('btn-toggle-pause-week');

  if (togglePauseBtn) {
    togglePauseBtn.textContent = isPaused ? '▶️ Återaktivera' : '⏸️ Pausa';
  }

  if (isPaused) {
    pausedBanner?.classList.remove('hidden');
    hostCard?.classList.add('hidden');
    votingMatrixWrapper?.classList.add('hidden');
    hostControlsSection?.classList.add('hidden');
    return;
  } else {
    pausedBanner?.classList.add('hidden');
    hostCard?.classList.remove('hidden');
    votingMatrixWrapper?.classList.remove('hidden');
  }

  const hostNameEl = document.getElementById('host-name-display');
  const hostAvatarBadge = document.getElementById('host-avatar-badge');
  const hostStatusSubtitle = document.getElementById('host-status-subtitle');
  const confirmedDateBanner = document.getElementById('confirmed-date-banner');
  const confirmedDateText = document.getElementById('confirmed-date-text');
  const hostNoteWrapper = document.getElementById('host-note-display-wrapper');
  const hostNoteText = document.getElementById('host-note-text');

  if (hostNameEl) hostNameEl.textContent = host ? host.name : 'Ingen värd tilldelad';
  if (hostAvatarBadge && host) hostAvatarBadge.textContent = isCurrentUserHost ? '👑' : host.name.charAt(0).toUpperCase();

  if (hostStatusSubtitle) {
    if (isCurrentUserHost) {
      hostStatusSubtitle.textContent = 'Du är värd denna vecka! Fyll i dina förslag nedan.';
    } else {
      hostStatusSubtitle.textContent = `${host?.name || 'Värden'} bjuder på middag denna vecka.`;
    }
  }

  if (state.weekData?.confirmed_day) {
    confirmedDateBanner?.classList.remove('hidden');
    if (confirmedDateText) confirmedDateText.textContent = state.weekData.confirmed_day;
  } else {
    confirmedDateBanner?.classList.add('hidden');
  }

  if (state.weekData?.host_notes) {
    hostNoteWrapper?.classList.remove('hidden');
    if (hostNoteText) hostNoteText.textContent = `"${state.weekData.host_notes}"`;
  } else {
    hostNoteWrapper?.classList.add('hidden');
  }

  if (hostControlsSection) {
    if (isCurrentUserHost) {
      hostControlsSection.classList.remove('hidden');
      renderHostInputs();
    } else {
      hostControlsSection.classList.add('hidden');
    }
  }
}

function renderHostInputs() {
  const container = document.getElementById('proposed-days-inputs');
  const noteInput = document.getElementById('input-host-note');
  if (!container) return;

  if (noteInput && state.weekData) {
    noteInput.value = state.weekData.host_notes || '';
  }

  let days = state.weekData?.proposed_days || [];
  if (days.length === 0) {
    days = [
      { id: 'd1', day: 'Onsdag', date: getWeekdayDate(state.selectedYear, state.selectedWeek, 2), time: '18:30' },
      { id: 'd2', day: 'Torsdag', date: getWeekdayDate(state.selectedYear, state.selectedWeek, 3), time: '18:30' },
    ];
  }

  container.innerHTML = days.map((d, index) => `
    <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 day-input-row" data-day-id="${d.id}">
      <input type="text" class="input-day-label flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white" value="${escapeHtml(d.day)}" placeholder="Veckodag (t.ex. Onsdag)">
      <input type="date" class="input-day-date w-36 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" value="${d.date || ''}">
      <input type="time" class="input-day-time w-24 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" value="${d.time || '18:30'}">
      <button type="button" onclick="removeDayRow(${index})" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition" title="Ta bort">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
      </button>
    </div>
  `).join('');
}

window.removeDayRow = function(index) {
  const container = document.getElementById('proposed-days-inputs');
  const rows = container.querySelectorAll('.day-input-row');
  if (rows.length > index) rows[index].remove();
};

function addDayRowOption() {
  const container = document.getElementById('proposed-days-inputs');
  if (!container) return;

  const newId = 'd_' + Date.now();
  const div = document.createElement('div');
  div.className = 'flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 day-input-row';
  div.dataset.dayId = newId;
  div.innerHTML = `
    <input type="text" class="input-day-label flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white" placeholder="Veckodag (t.ex. Fredag)">
    <input type="date" class="input-day-date w-36 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" value="${getWeekdayDate(state.selectedYear, state.selectedWeek, 4)}">
    <input type="time" class="input-day-time w-24 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" value="18:30">
    <button type="button" onclick="this.closest('.day-input-row').remove()" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition" title="Ta bort">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
    </button>
  `;
  container.appendChild(div);
}

function handleSaveProposalsClick() {
  const container = document.getElementById('proposed-days-inputs');
  const noteInput = document.getElementById('input-host-note');
  if (!container) return;

  const rows = container.querySelectorAll('.day-input-row');
  const proposedDays = [];

  rows.forEach((row, i) => {
    const label = row.querySelector('.input-day-label').value.trim();
    const date = row.querySelector('.input-day-date').value;
    const time = row.querySelector('.input-day-time').value;

    if (label) {
      proposedDays.push({
        id: row.dataset.dayId || 'd' + (i + 1),
        day: label,
        date: date,
        time: time
      });
    }
  });

  if (proposedDays.length === 0) {
    alert('Lägg till minst ett datumalternativ.');
    return;
  }

  saveProposals(proposedDays, noteInput?.value.trim() || '');
}

function renderVotingSection() {
  const container = document.getElementById('voting-days-container');
  const statusTag = document.getElementById('voting-status-tag');
  if (!container) return;

  const host = getHostForWeek(state.selectedYear, state.selectedWeek);
  const isCurrentUserHost = state.currentUser && host && state.currentUser.id === host.id;
  const days = state.weekData?.proposed_days || [];

  if (days.length === 0) {
    if (statusTag) {
      statusTag.textContent = 'Inga datum föreslagna än';
      statusTag.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-400';
    }

    container.innerHTML = `
      <div class="text-center py-10 px-4 bg-slate-950/60 rounded-2xl border border-dashed border-slate-800">
        <div class="text-3xl mb-2">⏳</div>
        <p class="text-sm font-bold text-slate-300">Värden har inte föreslagit datum för denna vecka än</p>
        <p class="text-xs text-slate-500 mt-1">
          ${isCurrentUserHost ? 'Använd kontrollpanelen ovan för att lägga till dina datum.' : `Väntar på att ${host?.name || 'värden'} ska lägga upp alternativ.`}
        </p>
      </div>
    `;
    return;
  }

  if (statusTag) {
    statusTag.textContent = 'Röstning öppen';
    statusTag.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }

  const tallies = {};
  days.forEach(d => {
    const dayVotes = state.votes.filter(v => v.day_id === d.id);
    const yesCount = dayVotes.filter(v => v.vote === 'yes').length;
    const maybeCount = dayVotes.filter(v => v.vote === 'maybe').length;
    tallies[d.id] = { yes: yesCount, maybe: maybeCount, score: yesCount * 2 + maybeCount };
  });

  const maxScore = Math.max(...Object.values(tallies).map(t => t.score), 0);

  container.innerHTML = days.map(d => {
    const dayVotes = state.votes.filter(v => v.day_id === d.id);
    const yesList = dayVotes.filter(v => v.vote === 'yes').map(v => getMemberName(v.member_id));
    const maybeList = dayVotes.filter(v => v.vote === 'maybe').map(v => getMemberName(v.member_id));
    const noList = dayVotes.filter(v => v.vote === 'no').map(v => getMemberName(v.member_id));

    const myVote = state.currentUser ? dayVotes.find(v => v.member_id === state.currentUser.id)?.vote : null;
    const isTopChoice = tallies[d.id].score === maxScore && maxScore > 0;
    const isConfirmed = state.weekData?.confirmed_day === `${d.day} ${d.time}`;

    return `
      <div class="bg-slate-950 border ${isConfirmed ? 'border-emerald-500 ring-2 ring-emerald-500/30' : isTopChoice ? 'border-amber-500/50 bg-amber-950/10' : 'border-slate-800'} rounded-2xl p-4 sm:p-5 transition flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <h4 class="text-base sm:text-lg font-bold text-white">${escapeHtml(d.day)} kl. ${escapeHtml(d.time || '18:30')}</h4>
            ${isConfirmed ? '<span class="px-2 py-0.5 rounded-md bg-emerald-500 text-slate-950 text-[10px] font-black uppercase">Fastställd</span>' : isTopChoice ? '<span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 text-[10px] font-bold uppercase border border-amber-500/30">Flest röster ⭐</span>' : ''}
          </div>
          <p class="text-xs text-slate-400 font-mono">${d.date ? formatDateSwedish(d.date) : ''}</p>

          <div class="pt-2 flex flex-wrap gap-1.5 text-[11px]">
            ${yesList.length > 0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">✅ ${yesList.join(', ')}</span>` : ''}
            ${maybeList.length > 0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">❓ ${maybeList.join(', ')}</span>` : ''}
            ${noList.length > 0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20">❌ ${noList.join(', ')}</span>` : ''}
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
          <button onclick="submitVote('${d.id}', 'yes')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer flex items-center gap-1.5 ${myVote === 'yes' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'bg-slate-900 hover:bg-emerald-500/20 text-slate-300 border border-slate-800'}">
            <span>✅ Kan</span>
          </button>
          <button onclick="submitVote('${d.id}', 'maybe')" class="px-3 py-2 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer flex items-center gap-1.5 ${myVote === 'maybe' ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-slate-900 hover:bg-amber-500/20 text-slate-300 border border-slate-800'}">
            <span>❓ Kanske</span>
          </button>
          <button onclick="submitVote('${d.id}', 'no')" class="px-3 py-2 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer flex items-center gap-1.5 ${myVote === 'no' ? 'bg-rose-500 text-slate-950 shadow-md shadow-rose-500/20' : 'bg-slate-900 hover:bg-rose-500/20 text-slate-300 border border-slate-800'}">
            <span>❌ Kan ej</span>
          </button>
          ${isCurrentUserHost ? `
            <button onclick="confirmFinalDate('${d.day} kl. ${d.time || '18:30'}')" class="ml-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-sm" title="Välj detta som officiellt datum">
              Välj dag
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderMatrixTable() {
  const table = document.getElementById('votes-matrix-table');
  if (!table) return;

  const days = state.weekData?.proposed_days || [];
  if (days.length === 0 || state.members.length === 0) {
    table.innerHTML = `<tr><td class="text-slate-500 text-center py-4">Ingen röstningsdata än</td></tr>`;
    return;
  }

  let html = `
    <thead>
      <tr class="border-b border-slate-800 text-slate-400">
        <th class="py-2 pr-4 font-semibold">Kompis</th>
        ${days.map(d => `<th class="py-2 px-3 text-center font-semibold text-slate-300">${escapeHtml(d.day)}<br><span class="text-[10px] text-slate-500">${escapeHtml(d.time || '18:30')}</span></th>`).join('')}
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-800/60">
  `;

  state.members.forEach(member => {
    const isMe = state.currentUser?.id === member.id;
    html += `
      <tr class="${isMe ? 'bg-amber-500/5 font-semibold text-white' : 'text-slate-300'}">
        <td class="py-2.5 pr-4 flex items-center gap-2">
          <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-bold flex items-center justify-center">${member.name.charAt(0)}</span>
          <span>${escapeHtml(member.name)} ${isMe ? '<span class="text-[10px] text-amber-400">(Du)</span>' : ''}</span>
        </td>
    `;

    days.forEach(d => {
      const vote = state.votes.find(v => v.member_id === member.id && v.day_id === d.id)?.vote;
      let badge = '<span class="text-slate-600">-</span>';
      if (vote === 'yes') badge = '<span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">Ja</span>';
      else if (vote === 'maybe') badge = '<span class="text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded">Kanske</span>';
      else if (vote === 'no') badge = '<span class="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded">Nej</span>';

      html += `<td class="py-2.5 px-3 text-center">${badge}</td>`;
    });

    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;
}

function renderSwapAlerts() {
  const container = document.getElementById('swap-alert-container');
  if (!container) return;

  if (!state.currentUser) {
    container.classList.add('hidden');
    return;
  }

  const myPendingSwaps = state.swaps.filter(s => 
    s.target_id === state.currentUser.id && s.status === 'pending'
  );

  if (myPendingSwaps.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = myPendingSwaps.map(swap => {
    const requester = state.members.find(m => m.id === swap.requester_id);
    return `
      <div class="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-in slide-in-from-top duration-300">
        <div class="flex items-center gap-3">
          <div class="text-2xl">🔄</div>
          <div>
            <h4 class="text-xs sm:text-sm font-bold text-white">Bytesförfrågan från ${escapeHtml(requester?.name || 'en vän')}</h4>
            <p class="text-xs text-amber-200/90">Vill byta sin ${swap.requester_week} mot din ${swap.target_week}.</p>
          </div>
        </div>
        <div class="flex items-center gap-2 w-full sm:w-auto">
          <button onclick="respondSwap('${swap.id}', 'accepted')" class="flex-1 sm:flex-none px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition cursor-pointer">Acceptera</button>
          <button onclick="respondSwap('${swap.id}', 'rejected')" class="flex-1 sm:flex-none px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer">Avböj</button>
        </div>
      </div>
    `;
  }).join('');
}

function openSwapModal() {
  if (!state.currentUser) {
    openLoginModal();
    return;
  }

  const modal = document.getElementById('modal-swap');
  const myWeekText = document.getElementById('swap-my-week-text');
  const targetSelect = document.getElementById('swap-target-select');

  const currentWeekId = getWeekId(state.selectedYear, state.selectedWeek);
  if (myWeekText) myWeekText.textContent = `${currentWeekId} (${getWeekDateRange(state.selectedYear, state.selectedWeek)})`;

  if (targetSelect) {
    const options = [];
    for (let i = 1; i <= 8; i++) {
      let w = state.selectedWeek + i;
      let y = state.selectedYear;
      if (w > 52) { w -= 52; y += 1; }
      
      const host = getHostForWeek(y, w);
      if (host && host.id !== state.currentUser.id) {
        options.push(`<option value="${host.id}|${getWeekId(y, w)}">V.${w} (${host.name}) - ${getWeekDateRange(y, w).split('–')[0].trim()}</option>`);
      }
    }
    targetSelect.innerHTML = options.join('') || '<option value="">Inga andra veckor tillgängliga</option>';
  }

  if (modal) modal.classList.remove('hidden');
}

function closeSwapModal() {
  const modal = document.getElementById('modal-swap');
  if (modal) modal.classList.add('hidden');
}

function openManageModal() {
  const modal = document.getElementById('modal-manage');
  renderManageMembersList();
  if (modal) modal.classList.remove('hidden');
}

function closeManageModal() {
  const modal = document.getElementById('modal-manage');
  if (modal) modal.classList.add('hidden');
}

function renderManageMembersList() {
  const container = document.getElementById('manage-members-list');
  if (!container) return;

  container.innerHTML = state.members.map((m, idx) => `
    <div class="flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-xs">
      <div class="flex items-center gap-2">
        <span class="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center">${idx + 1}</span>
        <span class="font-bold text-white">${escapeHtml(m.name)}</span>
      </div>
      <span class="text-slate-500 text-[11px]">Ordning #${idx + 1}</span>
    </div>
  `).join('');
}

// ================= GLOBAL HELPERS =================

function getMemberName(memberId) {
  const member = state.members.find(m => m.id === memberId);
  return member ? member.name : memberId;
}

function formatDateSwedish(isoDateStr) {
  try {
    const parts = isoDateStr.split('-');
    if (parts.length === 3) return `${parseInt(parts[2], 10)}/${parseInt(parts[1], 10)}`;
    return isoDateStr;
  } catch (e) {
    return isoDateStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

function renderApp() {
  renderHeaderUser();
  if (state.currentView === 'month') {
    renderMonthOverview();
  } else {
    renderWeekView();
  }
}

// ================= INITIALIZATION =================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('MIDA Dinner Calendar starting...');

  // Setup DOM Listeners
  document.getElementById('tab-btn-month')?.addEventListener('click', () => setViewMode('month'));
  document.getElementById('tab-btn-week')?.addEventListener('click', () => setViewMode('week'));

  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewMonthYear -= 1;
    }
    renderMonthOverview();
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewMonthYear += 1;
    }
    renderMonthOverview();
  });

  document.getElementById('btn-user-profile')?.addEventListener('click', openLoginModal);
  document.getElementById('btn-login-submit')?.addEventListener('click', handleLoginSubmit);
  document.getElementById('btn-login-cancel')?.addEventListener('click', closeLoginModal);

  document.getElementById('btn-prev-week')?.addEventListener('click', () => {
    state.selectedWeek -= 1;
    if (state.selectedWeek < 1) {
      state.selectedWeek = 52;
      state.selectedYear -= 1;
    }
    loadWeekData(state.selectedYear, state.selectedWeek).then(renderWeekView);
  });

  document.getElementById('btn-next-week')?.addEventListener('click', () => {
    state.selectedWeek += 1;
    if (state.selectedWeek > 52) {
      state.selectedWeek = 1;
      state.selectedYear += 1;
    }
    loadWeekData(state.selectedYear, state.selectedWeek).then(renderWeekView);
  });

  document.getElementById('btn-jump-current-week')?.addEventListener('click', () => {
    state.selectedYear = state.currentRealYear;
    state.selectedWeek = state.currentRealWeek;
    loadWeekData(state.selectedYear, state.selectedWeek).then(renderWeekView);
  });

  document.getElementById('btn-toggle-pause-week')?.addEventListener('click', togglePauseWeek);
  document.getElementById('btn-unpause-week')?.addEventListener('click', togglePauseWeek);

  document.getElementById('btn-add-day-option')?.addEventListener('click', addDayRowOption);
  document.getElementById('btn-save-proposals')?.addEventListener('click', handleSaveProposalsClick);

  document.getElementById('btn-open-swap-modal')?.addEventListener('click', openSwapModal);
  document.getElementById('btn-close-swap-modal')?.addEventListener('click', closeSwapModal);

  document.getElementById('btn-submit-swap-request')?.addEventListener('click', () => {
    const select = document.getElementById('swap-target-select');
    if (!select || !select.value) return;
    const [targetId, targetWeek] = select.value.split('|');
    requestSwap(targetId, targetWeek);
  });

  document.getElementById('btn-admin-manage')?.addEventListener('click', openManageModal);
  document.getElementById('btn-close-manage-modal')?.addEventListener('click', closeManageModal);

  document.getElementById('btn-save-new-pin')?.addEventListener('click', () => {
    const input = document.getElementById('input-new-pin');
    const newPin = input?.value.trim();
    if (!newPin || newPin.length < 4) {
      alert('Ange en PIN med minst 4 siffror.');
      return;
    }
    if (state.currentUser) {
      state.currentUser.pin = newPin;
      localStorage.setItem('mida_cached_members', JSON.stringify(state.members));
      if (supabaseClient) {
        supabaseClient.from('mida_members').update({ pin: newPin }).eq('id', state.currentUser.id).then();
      }
      alert('Din PIN-kod har uppdaterats!');
      input.value = '';
      closeManageModal();
    } else {
      openLoginModal();
    }
  });

  document.getElementById('btn-add-new-member')?.addEventListener('click', async () => {
    const input = document.getElementById('input-new-member-name');
    const name = input?.value.trim();
    if (!name) return;

    const newId = name.toLowerCase().replace(/\s+/g, '');
    const newMember = {
      id: newId,
      name: name,
      pin: '1234',
      rotation_order: state.members.length + 1
    };

    state.members.push(newMember);
    localStorage.setItem('mida_cached_members', JSON.stringify(state.members));

    if (supabaseClient) {
      try {
        await supabaseClient.from('mida_members').insert([newMember]);
      } catch (e) {
        console.warn('Failed to insert member to Supabase:', e);
      }
    }

    input.value = '';
    renderManageMembersList();
    renderApp();
  });

  document.getElementById('btn-copy-invite-link')?.addEventListener('click', () => {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      alert('Ingen Supabase-konfiguration aktiv att dela.');
      return;
    }
    const payload = btoa(JSON.stringify({ url, key }));
    const inviteUrl = `${window.location.origin}/mida#setup=${payload}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      alert('Kompis-länk kopierad!\nNär dina vänner klickar på länken ställs databasen in direkt på deras mobiler.');
    }).catch(() => {
      prompt('Kopiera denna länk och skicka till dina vänner:', inviteUrl);
    });
  });

  // Load initial data
  await loadMembers();
  initCurrentUser();
  await loadAllWeeksData();
  await loadWeekData(state.selectedYear, state.selectedWeek);
  
  // Set default view
  setViewMode('month');

  if (!state.currentUser) {
    setTimeout(openLoginModal, 600);
  }
});
