// Cloudflare Pages Function: Live iCalendar (.ics) feed for MIDA
// Endpoint: https://uppsaladeals.se/mida/calendar.ics (or webcal://...)

const SUPABASE_URL = 'https://jxcrcskgrotcxkxhoyuq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T68Zi9lPvBSq9ME4vMAsFg_lg_aAV9g';

const ANCHOR_YEAR = 2026;
const ANCHOR_WEEK = 35;
const ANCHOR_HOST_INDEX = 0; // David

const DEFAULT_MEMBERS = [
  { id: 'david', name: 'David', rotation_order: 1 },
  { id: 'sten', name: 'Sten', rotation_order: 2 },
  { id: 'arvida', name: 'Arvid A', rotation_order: 3 },
  { id: 'erik', name: 'Erik', rotation_order: 4 },
  { id: 'arvidh', name: 'Arvid H', rotation_order: 5 },
  { id: 'elis', name: 'Elis', rotation_order: 6 },
  { id: 'isak', name: 'Isak', rotation_order: 7 }
];

function getMondayOfISOWeek(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  return ISOweekStart;
}

function formatDateToICSDate(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateTimeToICS(dateStr, timeStr) {
  // dateStr: "2026-09-04", timeStr: "18:30"
  const cleanDate = dateStr.replace(/-/g, '');
  const cleanTime = (timeStr || '18:30').replace(':', '') + '00';
  return `${cleanDate}T${cleanTime}`;
}

function addHoursToDateTimeICS(dateStr, timeStr, hours = 3) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hr, min] = (timeStr || '18:30').split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hr + hours, min));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const hour = String(dt.getUTCHours()).padStart(2, '0');
  const minute = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}00`;
}

function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export async function onRequest(context) {
  try {
    // 1. Fetch Members & Weeks from Supabase
    let members = DEFAULT_MEMBERS;
    let weeksMap = {};

    try {
      const [membersRes, weeksRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/mida_members?select=*&order=rotation_order.asc`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }),
        fetch(`${SUPABASE_URL}/rest/v1/mida_weeks?select=*`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        })
      ]);

      if (membersRes.ok) {
        const memData = await membersRes.json();
        if (Array.isArray(memData) && memData.length > 0) {
          members = memData;
        }
      }

      if (weeksRes.ok) {
        const weeksData = await weeksRes.json();
        if (Array.isArray(weeksData)) {
          weeksData.forEach(w => {
            weeksMap[w.week_id] = w;
          });
        }
      }
    } catch (fetchErr) {
      console.warn('Supabase fetch error in calendar function:', fetchErr);
    }

    const sortedMembers = [...members].sort((a, b) => a.rotation_order - b.rotation_order);

    // 2. Generate events from 4 weeks in past to 24 weeks in future
    const now = new Date();
    // Approximate current ISO week
    const currentYear = now.getUTCFullYear();
    const startWeek = Math.max(1, 35); // Anchor start week (2026-W35)
    const totalWeeksToGenerate = 30;

    let eventsICS = [];

    for (let i = 0; i < totalWeeksToGenerate; i++) {
      let w = startWeek + i;
      let y = ANCHOR_YEAR;
      while (w > 52) {
        w -= 52;
        y += 1;
      }

      const weekId = `${y}-W${String(w).padStart(2, '0')}`;
      const weekData = weeksMap[weekId];

      // Calculate Host
      let host = null;
      if (weekData && weekData.host_id) {
        host = sortedMembers.find(m => m.id === weekData.host_id) || null;
      }
      if (!host) {
        const targetAbsoluteWeek = (y * 52) + w;
        const anchorAbsoluteWeek = (ANCHOR_YEAR * 52) + ANCHOR_WEEK;
        const diffWeeks = targetAbsoluteWeek - anchorAbsoluteWeek;
        let hostIdx = ((ANCHOR_HOST_INDEX + diffWeeks) % sortedMembers.length);
        if (hostIdx < 0) hostIdx += sortedMembers.length;
        host = sortedMembers[hostIdx] || sortedMembers[0];
      }

      const isPaused = weekData?.is_paused || (weekData?.host_notes && weekData.host_notes.includes('[PAUSED]'));
      const monday = getMondayOfISOWeek(y, w);
      const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

      if (isPaused) {
        eventsICS.push([
          'BEGIN:VEVENT',
          `UID:mida-paused-${weekId}@uppsaladeals.se`,
          `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
          `DTSTART;VALUE=DATE:${formatDateToICSDate(monday)}`,
          `DTEND;VALUE=DATE:${formatDateToICSDate(nextMonday)}`,
          `SUMMARY:${escapeICS(`⏸️ MIDA V.${w}: Pausad vecka`)}`,
          `DESCRIPTION:${escapeICS(`Ingen middag denna vecka (Paus).\\nMer info: https://uppsaladeals.se/mida`)}`,
          'STATUS:CONFIRMED',
          'END:VEVENT'
        ].join('\r\n'));
        continue;
      }

      // Check if a specific day is spikad / proposed
      const confirmedDayStr = weekData?.confirmed_day || '';
      const proposedDays = Array.isArray(weekData?.proposed_days) ? weekData.proposed_days : [];

      // Find date for confirmed day
      let confirmedDate = null;
      let confirmedTime = '18:30';

      if (confirmedDayStr) {
        // Try finding date in string e.g. "Fredag 2026-09-04 kl. 18:30"
        const dateMatch = confirmedDayStr.match(/\d{4}-\d{2}-\d{2}/);
        const timeMatch = confirmedDayStr.match(/\d{1,2}:\d{2}/);
        if (dateMatch) confirmedDate = dateMatch[0];
        if (timeMatch) confirmedTime = timeMatch[0];
      }

      if (confirmedDate) {
        // Confirmed Dinner Event with exact time!
        const dtStart = formatDateTimeToICS(confirmedDate, confirmedTime);
        const dtEnd = addHoursToDateTimeICS(confirmedDate, confirmedTime, 4);

        eventsICS.push([
          'BEGIN:VEVENT',
          `UID:mida-confirmed-${weekId}@uppsaladeals.se`,
          `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
          `DTSTART;TZID=Europe/Stockholm:${dtStart}`,
          `DTEND;TZID=Europe/Stockholm:${dtEnd}`,
          `SUMMARY:${escapeICS(`🍽️ MIDA: ${host.name} bjuder på middag!`)}`,
          `DESCRIPTION:${escapeICS(`Värd: ${host.name}\\nTid: kl. ${confirmedTime}\\n\\nSe vem som kommer och info på: https://uppsaladeals.se/mida`)}`,
          `LOCATION:${escapeICS(`Hemma hos ${host.name}`)}`,
          'STATUS:CONFIRMED',
          'BEGIN:VALARM',
          'TRIGGER:-PT2H',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeICS(`MIDA-middag hos ${host.name} om 2 timmar!`)}`,
          'END:VALARM',
          'END:VEVENT'
        ].join('\r\n'));

      } else if (proposedDays.length > 0) {
        // Show proposed options or host planning chip
        const proposedList = proposedDays.map(p => `${p.day} (${p.date}) kl. ${p.time || '18:30'}`).join('\\n');
        eventsICS.push([
          'BEGIN:VEVENT',
          `UID:mida-proposed-${weekId}@uppsaladeals.se`,
          `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
          `DTSTART;VALUE=DATE:${formatDateToICSDate(monday)}`,
          `DTEND;VALUE=DATE:${formatDateToICSDate(nextMonday)}`,
          `SUMMARY:${escapeICS(`👑 V.${w} MIDA-värd: ${host.name} (Röstning pågår)`)}`,
          `DESCRIPTION:${escapeICS(`Värd denna vecka är ${host.name}.\\nFöreslagna datum:\\n${proposedList}\\n\\nGå in och rösta på: https://uppsaladeals.se/mida`)}`,
          'STATUS:CONFIRMED',
          'END:VEVENT'
        ].join('\r\n'));

      } else {
        // All-day week event indicating who is host
        eventsICS.push([
          'BEGIN:VEVENT',
          `UID:mida-week-${weekId}@uppsaladeals.se`,
          `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
          `DTSTART;VALUE=DATE:${formatDateToICSDate(monday)}`,
          `DTEND;VALUE=DATE:${formatDateToICSDate(nextMonday)}`,
          `SUMMARY:${escapeICS(`👑 V.${w} MIDA-värd: ${host.name}`)}`,
          `DESCRIPTION:${escapeICS(`Värd denna vecka är ${host.name}.\\n\\nFöreslå datum och rösta på: https://uppsaladeals.se/mida`)}`,
          'STATUS:CONFIRMED',
          'END:VEVENT'
        ].join('\r\n'));
      }
    }

    // 3. Build Full iCalendar Feed
    const icsFeed = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MIDA//Middagsrotation//SV',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:MIDA Middagar 🍽️',
      'X-WR-CALDESC:Middagsrotation och spikade middagar för kompisgänget.',
      'X-WR-TIMEZONE:Europe/Stockholm',
      'X-PUBLISHED-TTL:PT1H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      eventsICS.join('\r\n'),
      'END:VCALENDAR'
    ].join('\r\n');

    return new Response(icsFeed, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="mida-calendar.ics"',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response('Error generating calendar feed: ' + err.message, { status: 500 });
  }
}
