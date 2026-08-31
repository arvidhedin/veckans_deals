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

    // 2. Generate events from anchor week 35 forward 30 weeks
    const now = new Date();
    const startWeek = Math.max(1, 35);
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
      if (isPaused) {
        // Skip paused weeks completely to keep calendar clean!
        continue;
      }

      const confirmedDayStr = weekData?.confirmed_day || '';
      const proposedDays = Array.isArray(weekData?.proposed_days) ? weekData.proposed_days : [];

      // Check if there is a confirmed/spikat date
      let confirmedDate = null;
      let confirmedTime = '18:30';

      if (confirmedDayStr) {
        const dateMatch = confirmedDayStr.match(/\d{4}-\d{2}-\d{2}/);
        const timeMatch = confirmedDayStr.match(/\d{1,2}:\d{2}/);
        if (dateMatch) confirmedDate = dateMatch[0];
        if (timeMatch) confirmedTime = timeMatch[0];
      }

      if (confirmedDate) {
        // 1. SPIKAD MIDDAG: Single exact event on this specific day and time!
        const dtStart = formatDateTimeToICS(confirmedDate, confirmedTime);
        const dtEnd = addHoursToDateTimeICS(confirmedDate, confirmedTime, 3);

        eventsICS.push([
          'BEGIN:VEVENT',
          `UID:mida-confirmed-${weekId}-${confirmedDate}@uppsaladeals.se`,
          `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
          `DTSTART;TZID=Europe/Stockholm:${dtStart}`,
          `DTEND;TZID=Europe/Stockholm:${dtEnd}`,
          `SUMMARY:${escapeICS(`🍽️ SPIKAD: MIDA hos ${host.name}!`)}`,
          `DESCRIPTION:${escapeICS(`Spikad middag hos ${host.name}!\\nTid: kl. ${confirmedTime}\\n\\nSe info på: https://uppsaladeals.se/mida`)}`,
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
        // 2. FÖRSLAG: Create individual calendar events for EACH proposed day at its exact proposed time!
        proposedDays.forEach((p, idx) => {
          if (!p.date) return;
          const pTime = p.time || '18:30';
          const dtStart = formatDateTimeToICS(p.date, pTime);
          const dtEnd = addHoursToDateTimeICS(p.date, pTime, 3);

          eventsICS.push([
            'BEGIN:VEVENT',
            `UID:mida-prop-${weekId}-${p.id || idx}@uppsaladeals.se`,
            `DTSTAMP:${formatDateToICSDate(now)}T000000Z`,
            `DTSTART;TZID=Europe/Stockholm:${dtStart}`,
            `DTEND;TZID=Europe/Stockholm:${dtEnd}`,
            `SUMMARY:${escapeICS(`❓ FÖRSLAG: MIDA hos ${host.name}`)}`,
            `DESCRIPTION:${escapeICS(`Föreslaget datum för middag hos ${host.name}.\\nDag: ${p.day} (${p.date}) kl. ${pTime}\\n\\nRösta på: https://uppsaladeals.se/mida`)}`,
            `LOCATION:${escapeICS(`Hemma hos ${host.name}`)}`,
            'STATUS:TENTATIVE',
            'END:VEVENT'
          ].join('\r\n'));
        });
      }
      // If no days proposed and not confirmed yet, don't output anything to keep the calendar uncluttered!
    }

    // 3. Build Full iCalendar Feed
    const icsFeed = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MIDA//Middagsrotation//SV',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:MIDA Middagar 🍽️',
      'X-WR-CALDESC:Middagsförslag och spikade middagar för kompisgänget.',
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
        'Cache-Control': 'public, max-age=1800, stale-while-revalidate=300',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response('Error generating calendar feed: ' + err.message, { status: 500 });
  }
}
