/**
 * MIDA Middagskalender - Month Grid & 3-Tier Voting Engine
 * https://uppsaladeals.se/mida
 */

// Dynamic Supabase Configuration
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

// Anchor: 2026-W35 = David, 2026-W36 = Sten
const ANCHOR_YEAR = 2026;
const ANCHOR_WEEK = 35;
const ANCHOR_HOST_INDEX = 0; // David

// Global State
const state = {
  currentUser: null,
  members: [],
  viewMonth: new Date().getMonth(), // 0 - 11
  viewYear: new Date().getFullYear(),
  activeWeekNumber: getISOWeek(new Date()),
  activeWeekYear: new Date().getFullYear(),
  currentRealWeek: getISOWeek(new Date()),
  currentRealYear: new Date().getFullYear(),
  allWeeksCache: {}, // { "2026-W36": { week_id, host_id, is_paused, proposed_days, host_notes, confirmed_day } }
  allVotesCache: {}, // { "2026-W36": [ { week_id, member_id, day_id, vote } ] }
  swaps: [],
  selectedDayForModal: null, // { dateStr, weekNumber, year, dayId, dayObj }
};

// ================= DATE HELPERS =================

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
  const start = getWeekStartDate(year, weekNumber);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${year}`;
}

function getWeekId(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Get all calendar week rows that intersect this month
function getCalendarWeeksForMonth(year, monthIndex) {
  const weeks = [];
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0);

  // Find Monday of the first week
  const startCal = new Date(firstDayOfMonth);
  const dayOfWeek = (startCal.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  startCal.setDate(startCal.getDate() - dayOfWeek);

  let cur = new Date(startCal);
  while (cur <= lastDayOfMonth || cur.getDay() !== 1) {
    const wNum = getISOWeek(cur);
    const wYear = (monthIndex === 11 && wNum === 1) ? year + 1 : (monthIndex === 0 && wNum > 50) ? year - 1 : year;
    const weekId = getWeekId(wYear, wNum);

    const daysInWeek = [];
    for (let i = 0; i < 7; i++) {
      const dCopy = new Date(cur);
      daysInWeek.push({
        date: new Date(dCopy),
        dateStr: formatDateStr(dCopy),
        dayNum: dCopy.getDate(),
        isCurrentMonth: dCopy.getMonth() === monthIndex,
        isToday: dCopy.toDateString() === new Date().toDateString(),
        weekdayIndex: i, // 0 = Mon, 6 = Sun
      });
      cur.setDate(cur.getDate() + 1);
    }

    weeks.push({
      weekNumber: wNum,
      year: wYear,
      weekId: weekId,
      days: daysInWeek
    });

    if (cur > lastDayOfMonth && cur.getDay() === 1) break;
  }

  return weeks;
}

// ================= ROTATION ENGINE =================

function getHostForWeek(year, week) {
  const weekId = getWeekId(year, week);

  // Check Swap
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

  if (!state.members || state.members.length === 0) return null;
  const sorted = [...state.members].sort((a, b) => a.rotation_order - b.rotation_order);

  const targetAbsoluteWeek = (year * 52) + week;
  const anchorAbsoluteWeek = (ANCHOR_YEAR * 52) + ANCHOR_WEEK;
  const diffWeeks = targetAbsoluteWeek - anchorAbsoluteWeek;

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
      console.warn('Could not fetch members from Supabase', e);
    }
  }

  const cached = localStorage.getItem('mida_cached_members');
  state.members = cached ? JSON.parse(cached) : DEFAULT_MEMBERS;
}

async function loadAllWeeksAndVotes() {
  if (supabaseClient) {
    try {
      const { data: weeksData } = await supabaseClient.from('mida_weeks').select('*');
      if (weeksData) {
        weeksData.forEach(w => {
          state.allWeeksCache[w.week_id] = w;
        });
      }

      const { data: votesData } = await supabaseClient.from('mida_votes').select('*');
      if (votesData) {
        state.allVotesCache = {};
        votesData.forEach(v => {
          if (!state.allVotesCache[v.week_id]) state.allVotesCache[v.week_id] = [];
          state.allVotesCache[v.week_id].push(v);
        });
      }

      const { data: swapsData } = await supabaseClient.from('mida_swaps').select('*');
      if (swapsData) state.swaps = swapsData;
    } catch (e) {
      console.warn('Supabase fetch all error', e);
    }
  }
}

async function saveWeekData(weekId, data) {
  state.allWeeksCache[weekId] = data;
  localStorage.setItem(`mida_week_${weekId}`, JSON.stringify(data));

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_weeks').upsert(data, { onConflict: 'week_id' });
    } catch (e) {
      console.warn('Supabase save week error', e);
    }
  }
}

async function castVote(voteType) {
  if (!state.currentUser) {
    openLoginModal();
    return;
  }

  const dayInfo = state.selectedDayForModal;
  if (!dayInfo) return;

  const weekId = getWeekId(dayInfo.year, dayInfo.weekNumber);
  const dayId = dayInfo.dayId || dayInfo.dateStr;

  if (!state.allVotesCache[weekId]) state.allVotesCache[weekId] = [];

  const existingIdx = state.allVotesCache[weekId].findIndex(v => 
    v.member_id === state.currentUser.id && v.day_id === dayId
  );

  const voteObj = {
    week_id: weekId,
    member_id: state.currentUser.id,
    day_id: dayId,
    vote: voteType, // 'yes', 'yes_no_alcohol', 'no'
    updated_at: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    state.allVotesCache[weekId][existingIdx] = voteObj;
  } else {
    state.allVotesCache[weekId].push(voteObj);
  }

  localStorage.setItem(`mida_votes_${weekId}`, JSON.stringify(state.allVotesCache[weekId]));

  renderDayVoteModalContent();
  renderCalendarGrid();
  renderActiveWeekDetail();

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_votes').upsert(voteObj, { onConflict: 'week_id,member_id,day_id' });
    } catch (e) {
      console.warn('Supabase vote error', e);
    }
  }
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
  document.getElementById('modal-login')?.classList.add('hidden');
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

// ================= CALENDAR GRID RENDERING =================

function renderCalendarGrid() {
  const monthTitle = document.getElementById('month-title-label');
  const container = document.getElementById('calendar-grid-container');
  if (!container) return;

  const monthNames = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'];
  if (monthTitle) monthTitle.textContent = `${monthNames[state.viewMonth]} ${state.viewYear}`;

  const calWeeks = getCalendarWeeksForMonth(state.viewYear, state.viewMonth);

  container.innerHTML = calWeeks.map(w => {
    const host = getHostForWeek(w.year, w.weekNumber);
    const weekData = state.allWeeksCache[w.weekId];
    const isPaused = !!weekData?.is_paused;
    const isCurrentWeek = w.weekNumber === state.currentRealWeek && w.year === state.currentRealYear;
    const isActiveWeek = w.weekNumber === state.activeWeekNumber && w.year === state.activeWeekYear;
    const isMyHostWeek = state.currentUser && host && state.currentUser.id === host.id;

    // Week column on the left
    let weekColHtml = `
      <div onclick="selectActiveWeek(${w.year}, ${w.weekNumber})" class="p-2 sm:p-3 bg-slate-950/80 border-r border-slate-800/80 flex flex-col justify-between items-center cursor-pointer hover:bg-slate-800/60 transition group text-center">
        <div>
          <span class="text-[11px] sm:text-xs font-black ${isCurrentWeek ? 'text-amber-400' : 'text-slate-400'} group-hover:text-white">
            V.${w.weekNumber}
          </span>
        </div>
        <div class="my-1">
          <span class="w-6 h-6 rounded-lg ${isPaused ? 'bg-slate-800 text-slate-500' : isMyHostWeek ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-800 text-amber-300 font-bold'} text-[10px] flex items-center justify-center shadow-sm" title="${escapeHtml(host?.name || '')}">
            ${isPaused ? '⏸️' : isMyHostWeek ? '👑' : host ? host.name.charAt(0) : '?'}
          </span>
        </div>
        <span class="text-[9px] text-slate-500 truncate max-w-[45px]">${isPaused ? 'Paus' : escapeHtml(host?.name.split(' ')[0] || '')}</span>
      </div>
    `;

    // 7 Day Boxes
    let daysHtml = w.days.map(d => {
      const isProposed = !isPaused && weekData?.proposed_days?.some(p => p.date === d.dateStr);
      const proposedDayObj = isProposed ? weekData.proposed_days.find(p => p.date === d.dateStr) : null;
      const isConfirmed = !isPaused && weekData?.confirmed_day && (weekData.confirmed_day.includes(d.dateStr) || (proposedDayObj && weekData.confirmed_day.includes(proposedDayObj.day)));

      // Vote counts for this day
      const dayId = proposedDayObj?.id || d.dateStr;
      const weekVotes = state.allVotesCache[w.weekId] || [];
      const dayVotes = weekVotes.filter(v => v.day_id === dayId);
      const yesAlcCount = dayVotes.filter(v => v.vote === 'yes').length;
      const yesNoAlcCount = dayVotes.filter(v => v.vote === 'yes_no_alcohol').length;
      const noCount = dayVotes.filter(v => v.vote === 'no').length;

      // Event chips
      let eventChipHtml = '';
      if (isPaused) {
        eventChipHtml = '';
      } else if (isConfirmed) {
        eventChipHtml = `
          <div class="mt-1 px-1.5 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold truncate flex items-center gap-1 shadow-sm">
            <span>✓</span>
            <span class="truncate">Spikat ${proposedDayObj?.time || '18:30'}</span>
          </div>
        `;
      } else if (isProposed) {
        eventChipHtml = `
          <div class="mt-1 px-1.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold shadow-sm space-y-0.5">
            <div class="flex items-center justify-between">
              <span>🍽️ ${proposedDayObj?.time || '18:30'}</span>
              <span class="text-[9px] opacity-80">${host?.name.split(' ')[0]}</span>
            </div>
            ${(yesAlcCount > 0 || yesNoAlcCount > 0 || noCount > 0) ? `
              <div class="flex items-center gap-1.5 text-[9px] pt-0.5 font-mono">
                ${yesAlcCount > 0 ? `<span class="text-emerald-400 font-bold">🍻${yesAlcCount}</span>` : ''}
                ${yesNoAlcCount > 0 ? `<span class="text-sky-400 font-bold">🥤${yesNoAlcCount}</span>` : ''}
                ${noCount > 0 ? `<span class="text-rose-400 font-bold">❌${noCount}</span>` : ''}
              </div>
            ` : ''}
          </div>
        `;
      }

      return `
        <div onclick="handleDayCellClick('${d.dateStr}', ${w.year}, ${w.weekNumber}, ${isProposed ? `'${proposedDayObj.id}'` : 'null'})" class="min-h-[80px] sm:min-h-[100px] p-1.5 sm:p-2 border-r border-slate-800/60 last:border-r-0 flex flex-col justify-between transition cursor-pointer hover:bg-slate-800/40 group ${d.isCurrentMonth ? 'bg-slate-900' : 'bg-slate-950/40 text-slate-600'} ${d.isToday ? 'ring-1 ring-inset ring-amber-400/50 bg-amber-500/5' : ''}">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold ${d.isToday ? 'w-5 h-5 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center text-[11px]' : d.isCurrentMonth ? 'text-slate-300' : 'text-slate-600'}">
              ${d.dayNum}
            </span>
          </div>

          <div class="flex-grow flex flex-col justify-end">
            ${eventChipHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="cal-grid-row ${isActiveWeek ? 'bg-amber-500/[0.02]' : ''}">
        ${weekColHtml}
        ${daysHtml}
      </div>
    `;
  }).join('');
}

window.selectActiveWeek = function(year, weekNumber) {
  state.activeWeekYear = year;
  state.activeWeekNumber = weekNumber;
  renderCalendarGrid();
  renderActiveWeekDetail();
};

// ================= DAY MODAL & 3-TIER VOTING =================

window.handleDayCellClick = function(dateStr, year, weekNumber, dayId) {
  const weekId = getWeekId(year, weekNumber);
  const weekData = state.allWeeksCache[weekId];
  const host = getHostForWeek(year, weekNumber);
  const isHost = state.currentUser && host && state.currentUser.id === host.id;

  // Find or create proposed day object
  let dayObj = weekData?.proposed_days?.find(p => p.date === dateStr);

  // If clicking on a day not proposed yet, and current user IS host, offer to add it!
  if (!dayObj && isHost) {
    const weekdayNames = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    const d = new Date(dateStr + 'T12:00:00');
    const weekday = weekdayNames[d.getDay()];

    const confirmAdd = confirm(`Vill du föreslå ${weekday} (${dateStr}) kl. 18:30 för middagen?`);
    if (confirmAdd) {
      const newDay = {
        id: 'd_' + Date.now(),
        day: weekday,
        date: dateStr,
        time: '18:30'
      };
      const updatedDays = [...(weekData?.proposed_days || []), newDay];
      const updatedWeek = {
        ...(weekData || {}),
        week_id: weekId,
        week_number: weekNumber,
        year: year,
        host_id: host.id,
        proposed_days: updatedDays,
        updated_at: new Date().toISOString()
      };
      saveWeekData(weekId, updatedWeek);
      dayObj = newDay;
    } else {
      return;
    }
  }

  state.selectedDayForModal = {
    dateStr,
    year,
    weekNumber,
    dayId: dayObj?.id || dayId || dateStr,
    dayObj: dayObj
  };

  openDayVoteModal();
};

function openDayVoteModal() {
  const modal = document.getElementById('modal-day-vote');
  if (!modal) return;

  renderDayVoteModalContent();
  modal.classList.remove('hidden');
}

function closeDayVoteModal() {
  document.getElementById('modal-day-vote')?.classList.add('hidden');
}

function renderDayVoteModalContent() {
  const dayInfo = state.selectedDayForModal;
  if (!dayInfo) return;

  const weekId = getWeekId(dayInfo.year, dayInfo.weekNumber);
  const weekData = state.allWeeksCache[weekId];
  const host = getHostForWeek(dayInfo.year, dayInfo.weekNumber);
  const isHost = state.currentUser && host && state.currentUser.id === host.id;

  const weekdayLabel = document.getElementById('day-modal-weekday');
  const titleEl = document.getElementById('day-modal-title');
  const hostNameEl = document.getElementById('day-modal-host-name');
  const timeBadge = document.getElementById('day-modal-time-badge');
  const breakdownContainer = document.getElementById('day-modal-votes-breakdown');
  const hostActions = document.getElementById('day-modal-host-actions');

  const d = new Date(dayInfo.dateStr + 'T12:00:00');
  const weekdayNames = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  
  if (weekdayLabel) weekdayLabel.textContent = `${weekdayNames[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  if (titleEl) titleEl.textContent = dayInfo.dayObj ? `Middag: ${dayInfo.dayObj.day}` : 'Middagsdatum';
  if (hostNameEl) hostNameEl.textContent = host ? host.name : 'Värd';
  if (timeBadge) timeBadge.textContent = `kl. ${dayInfo.dayObj?.time || '18:30'}`;

  // Highlight my current vote button
  const dayId = dayInfo.dayId;
  const weekVotes = state.allVotesCache[weekId] || [];
  const myVoteObj = state.currentUser ? weekVotes.find(v => v.member_id === state.currentUser.id && v.day_id === dayId) : null;
  const myVote = myVoteObj?.vote;

  const btnYes = document.getElementById('vote-btn-yes');
  const btnNoAlc = document.getElementById('vote-btn-no-alc');
  const btnNo = document.getElementById('vote-btn-no');

  btnYes?.classList.remove('bg-emerald-500/20', 'border-emerald-500', 'ring-2', 'ring-emerald-500/40');
  btnNoAlc?.classList.remove('bg-sky-500/20', 'border-sky-500', 'ring-2', 'ring-sky-500/40');
  btnNo?.classList.remove('bg-rose-500/20', 'border-rose-500', 'ring-2', 'ring-rose-500/40');

  if (myVote === 'yes') {
    btnYes?.classList.add('bg-emerald-500/20', 'border-emerald-500', 'ring-2', 'ring-emerald-500/40');
  } else if (myVote === 'yes_no_alcohol') {
    btnNoAlc?.classList.add('bg-sky-500/20', 'border-sky-500', 'ring-2', 'ring-sky-500/40');
  } else if (myVote === 'no') {
    btnNo?.classList.add('bg-rose-500/20', 'border-rose-500', 'ring-2', 'ring-rose-500/40');
  }

  // Votes breakdown
  const dayVotes = weekVotes.filter(v => v.day_id === dayId);
  const yesAlcMembers = dayVotes.filter(v => v.vote === 'yes').map(v => getMemberName(v.member_id));
  const yesNoAlcMembers = dayVotes.filter(v => v.vote === 'yes_no_alcohol').map(v => getMemberName(v.member_id));
  const noMembers = dayVotes.filter(v => v.vote === 'no').map(v => getMemberName(v.member_id));

  if (breakdownContainer) {
    if (dayVotes.length === 0) {
      breakdownContainer.innerHTML = `<p class="text-slate-500 italic py-1">Inga röster registrerade på denna dag än.</p>`;
    } else {
      breakdownContainer.innerHTML = `
        ${yesAlcMembers.length > 0 ? `
          <div class="flex items-center justify-between p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span class="font-bold text-emerald-400">🍻 JA (Med alkohol)</span>
            <span class="text-slate-300 font-medium">${yesAlcMembers.join(', ')}</span>
          </div>
        ` : ''}
        ${yesNoAlcMembers.length > 0 ? `
          <div class="flex items-center justify-between p-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
            <span class="font-bold text-sky-400">🥤 Ja, men utan alkohol</span>
            <span class="text-slate-300 font-medium">${yesNoAlcMembers.join(', ')}</span>
          </div>
        ` : ''}
        ${noMembers.length > 0 ? `
          <div class="flex items-center justify-between p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <span class="font-bold text-rose-400">❌ Nej, kan inte</span>
            <span class="text-slate-300 font-medium">${noMembers.join(', ')}</span>
          </div>
        ` : ''}
      `;
    }
  }

  // Host finalize button
  if (hostActions) {
    if (isHost && dayInfo.dayObj) {
      hostActions.classList.remove('hidden');
      const confirmBtn = document.getElementById('btn-day-modal-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          const finalStr = `${dayInfo.dayObj.day} ${dayInfo.dateStr} kl. ${dayInfo.dayObj.time || '18:30'}`;
          const updated = { ...(weekData || {}), confirmed_day: finalStr, updated_at: new Date().toISOString() };
          saveWeekData(weekId, updated);
          alert(`Middag fastställd till ${finalStr}!`);
          closeDayVoteModal();
          renderApp();
        };
      }
    } else {
      hostActions.classList.add('hidden');
    }
  }
}

// ================= ACTIVE WEEK SUMMARY & MATRIX =================

function renderActiveWeekDetail() {
  const weekId = getWeekId(state.activeWeekYear, state.activeWeekNumber);
  const host = getHostForWeek(state.activeWeekYear, state.activeWeekNumber);
  const weekData = state.allWeeksCache[weekId];
  const isPaused = !!weekData?.is_paused;
  const isHost = state.currentUser && host && state.currentUser.id === host.id;

  const titleEl = document.getElementById('week-detail-title');
  const statusBadge = document.getElementById('week-detail-status-badge');
  const datesEl = document.getElementById('week-detail-dates');
  const avatarEl = document.getElementById('week-detail-avatar');
  const pauseBtn = document.getElementById('btn-toggle-pause-week');
  const quickHostPanel = document.getElementById('quick-host-panel');
  const matrixTable = document.getElementById('votes-matrix-table');

  if (titleEl) titleEl.textContent = `Vecka ${state.activeWeekNumber}`;
  if (datesEl) datesEl.textContent = getWeekDateRange(state.activeWeekYear, state.activeWeekNumber);

  if (statusBadge) {
    if (isPaused) {
      statusBadge.textContent = 'Pausad vecka';
      statusBadge.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700';
    } else if (weekData?.confirmed_day) {
      statusBadge.textContent = `Spikad: ${weekData.confirmed_day}`;
      statusBadge.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    } else {
      statusBadge.textContent = `Värd: ${host?.name || 'Ingen'}`;
      statusBadge.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30';
    }
  }

  if (avatarEl && host) {
    avatarEl.textContent = isPaused ? '⏸️' : isHost ? '👑' : host.name.charAt(0);
  }

  if (pauseBtn) {
    pauseBtn.textContent = isPaused ? '▶️ Återaktivera' : '⏸️ Pausa';
  }

  // Host quick proposals
  if (quickHostPanel) {
    if (isHost && !isPaused) {
      quickHostPanel.classList.remove('hidden');
      renderQuickHostDays(weekId, weekData);
    } else {
      quickHostPanel.classList.add('hidden');
    }
  }

  // Render Vote Matrix Table
  if (matrixTable) {
    const proposedDays = weekData?.proposed_days || [];
    if (proposedDays.length === 0 || isPaused) {
      matrixTable.innerHTML = `<tr><td class="text-slate-500 text-center py-4">${isPaused ? 'Veckan är pausad' : 'Inga föreslagna dagar än för denna vecka'}</td></tr>`;
      return;
    }

    const weekVotes = state.allVotesCache[weekId] || [];

    let html = `
      <thead>
        <tr class="border-b border-slate-800 text-slate-400 text-xs">
          <th class="py-2 pr-3 font-bold">Kompis</th>
          ${proposedDays.map(d => `<th class="py-2 px-2 text-center font-semibold text-slate-300">${escapeHtml(d.day)}<br><span class="text-[10px] text-slate-500 font-mono">${d.date.split('-').slice(1).join('/')}</span></th>`).join('')}
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800/60 text-xs">
    `;

    state.members.forEach(member => {
      const isMe = state.currentUser?.id === member.id;
      html += `
        <tr class="${isMe ? 'bg-amber-500/5 font-semibold text-white' : 'text-slate-300'}">
          <td class="py-2.5 pr-3 flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-bold flex items-center justify-center">${member.name.charAt(0)}</span>
            <span>${escapeHtml(member.name)} ${isMe ? '<span class="text-[10px] text-amber-400">(Du)</span>' : ''}</span>
          </td>
      `;

      proposedDays.forEach(d => {
        const vote = weekVotes.find(v => v.member_id === member.id && v.day_id === d.id)?.vote;
        let badge = '<span class="text-slate-600">-</span>';
        if (vote === 'yes') {
          badge = '<span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">🍻 JA</span>';
        } else if (vote === 'yes_no_alcohol') {
          badge = '<span class="text-sky-400 font-bold bg-sky-500/10 px-2 py-0.5 rounded text-[11px]">🥤 Ja (utan alc)</span>';
        } else if (vote === 'no') {
          badge = '<span class="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded text-[11px]">❌ Nej</span>';
        }

        html += `<td class="py-2.5 px-2 text-center">${badge}</td>`;
      });

      html += `</tr>`;
    });

    html += `</tbody>`;
    matrixTable.innerHTML = html;
  }
}

function renderQuickHostDays(weekId, weekData) {
  const container = document.getElementById('quick-host-days-list');
  if (!container) return;

  const days = weekData?.proposed_days || [];
  container.innerHTML = days.map((d, index) => `
    <div class="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs">
      <span class="font-bold text-white flex-1">${escapeHtml(d.day)} ${d.date} kl. ${d.time || '18:30'}</span>
      <button onclick="removeQuickDay('${weekId}', ${index})" class="p-1 text-slate-500 hover:text-rose-400 rounded transition" title="Ta bort">
        ✕
      </button>
    </div>
  `).join('') || '<p class="text-xs text-slate-400 italic">Inga dagar tillagda än. Klicka i kalendern för att lägga till!</p>';
}

window.removeQuickDay = function(weekId, index) {
  const weekData = state.allWeeksCache[weekId];
  if (!weekData || !weekData.proposed_days) return;
  weekData.proposed_days.splice(index, 1);
  saveWeekData(weekId, weekData);
  renderApp();
};

// ================= MODAL MANAGERS =================

function openSwapModal() {
  if (!state.currentUser) {
    openLoginModal();
    return;
  }
  const modal = document.getElementById('modal-swap');
  const myWeekText = document.getElementById('swap-my-week-text');
  const targetSelect = document.getElementById('swap-target-select');

  const currentWeekId = getWeekId(state.activeWeekYear, state.activeWeekNumber);
  if (myWeekText) myWeekText.textContent = `${currentWeekId} (${getWeekDateRange(state.activeWeekYear, state.activeWeekNumber)})`;

  if (targetSelect) {
    const options = [];
    for (let i = 1; i <= 8; i++) {
      let w = state.activeWeekNumber + i;
      let y = state.activeWeekYear;
      if (w > 52) { w -= 52; y += 1; }
      const host = getHostForWeek(y, w);
      if (host && host.id !== state.currentUser.id) {
        options.push(`<option value="${host.id}|${getWeekId(y, w)}">V.${w} (${host.name}) - ${getWeekDateRange(y, w).split('–')[0].trim()}</option>`);
      }
    }
    targetSelect.innerHTML = options.join('') || '<option value="">Inga andra veckor tillgängliga</option>';
  }

  modal?.classList.remove('hidden');
}

function closeSwapModal() {
  document.getElementById('modal-swap')?.classList.add('hidden');
}

function openManageModal() {
  const modal = document.getElementById('modal-manage');
  renderManageMembersList();
  modal?.classList.remove('hidden');
}

function closeManageModal() {
  document.getElementById('modal-manage')?.classList.add('hidden');
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

window.respondSwap = async function(swapId, newStatus) {
  const swap = state.swaps.find(s => s.id === swapId);
  if (!swap) return;

  swap.status = newStatus;
  localStorage.setItem('mida_all_swaps', JSON.stringify(state.swaps));

  if (supabaseClient) {
    try {
      await supabaseClient.from('mida_swaps').update({ status: newStatus }).eq('id', swapId);
    } catch (e) {
      console.warn('Swap update error', e);
    }
  }

  renderApp();
};

function getMemberName(memberId) {
  const member = state.members.find(m => m.id === memberId);
  return member ? member.name : memberId;
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
  renderCalendarGrid();
  renderActiveWeekDetail();
  renderSwapAlerts();
}

// ================= APP INITIALIZATION =================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('MIDA Month Grid & 3-Tier Voting Engine started...');

  // Month navigation
  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    renderCalendarGrid();
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    renderCalendarGrid();
  });

  document.getElementById('btn-today-jump')?.addEventListener('click', () => {
    state.viewMonth = new Date().getMonth();
    state.viewYear = new Date().getFullYear();
    state.activeWeekNumber = getISOWeek(new Date());
    state.activeWeekYear = new Date().getFullYear();
    renderApp();
  });

  // User auth buttons
  document.getElementById('btn-user-profile')?.addEventListener('click', openLoginModal);
  document.getElementById('btn-login-submit')?.addEventListener('click', handleLoginSubmit);
  document.getElementById('btn-login-cancel')?.addEventListener('click', closeLoginModal);

  // Day modal close
  document.getElementById('btn-close-day-modal')?.addEventListener('click', closeDayVoteModal);

  // Pause week toggle
  document.getElementById('btn-toggle-pause-week')?.addEventListener('click', () => {
    const weekId = getWeekId(state.activeWeekYear, state.activeWeekNumber);
    const weekData = state.allWeeksCache[weekId] || {
      week_id: weekId,
      week_number: state.activeWeekNumber,
      year: state.activeWeekYear,
      host_id: getHostForWeek(state.activeWeekYear, state.activeWeekNumber)?.id,
      is_paused: false,
      proposed_days: []
    };
    weekData.is_paused = !weekData.is_paused;
    weekData.updated_at = new Date().toISOString();
    saveWeekData(weekId, weekData);
    renderApp();
  });

  // Swap modal
  document.getElementById('btn-open-swap-modal')?.addEventListener('click', openSwapModal);
  document.getElementById('btn-close-swap-modal')?.addEventListener('click', closeSwapModal);
  document.getElementById('btn-submit-swap-request')?.addEventListener('click', () => {
    const select = document.getElementById('swap-target-select');
    if (!select || !select.value) return;
    const [targetId, targetWeek] = select.value.split('|');
    const swapObj = {
      id: 'swap_' + Date.now(),
      requester_id: state.currentUser.id,
      requester_week: getWeekId(state.activeWeekYear, state.activeWeekNumber),
      target_id: targetId,
      target_week: targetWeek,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    state.swaps.push(swapObj);
    localStorage.setItem('mida_all_swaps', JSON.stringify(state.swaps));
    if (supabaseClient) supabaseClient.from('mida_swaps').insert([swapObj]).then();
    alert('Bytesförfrågan skickad!');
    closeSwapModal();
    renderApp();
  });

  // Admin / manage modal
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
      if (supabaseClient) supabaseClient.from('mida_members').update({ pin: newPin }).eq('id', state.currentUser.id).then();
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
    if (supabaseClient) supabaseClient.from('mida_members').insert([newMember]).then();
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

  // Load data & start
  await loadMembers();
  initCurrentUser();
  await loadAllWeeksAndVotes();
  renderApp();

  if (!state.currentUser) {
    setTimeout(openLoginModal, 600);
  }
});
