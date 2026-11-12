// Uploads this week's ICA offers to uppsaladeals.se. Loaded by the bookmarklet on a page
// on www.ica.se: it reads the configured stores' offer pages in the user's own browser
// (ica.se blocks scripted requests since 2026-10-28) and POSTs them to /api/ica-offers,
// which stores them for the nightly build (scrapers/ica.py) and starts a new build.
//
// The bookmarklet sets window.__UPPSALADEALS_ICA_TOKEN before loading this file.
(async () => {
  const UPLOAD_URL = 'https://uppsaladeals.se/api/ica-offers';
  // Same stores as STORES in scrapers/ica.py
  const STORES = {
    'ICA Nära Råbyvägen': '/erbjudanden/ica-nara-rabyvagen-1003963/',
    'ICA Supermarket Torgkassen': '/erbjudanden/ica-supermarket-torgkassen-1003821/',
    'ICA Nära Rosendal': '/erbjudanden/ica-nara-rosendal-1004328/',
    'ICA Supermarket Väst': '/erbjudanden/ica-supermarket-vast-1003761/',
    'ICA Vretgränd': '/erbjudanden/ica-vretgrand-1003558/',
    'ICA Supermarket City': '/erbjudanden/ica-supermarket-city-uppsala-1003381/',
    'ICA Supermarket Luthagens Livs': '/erbjudanden/ica-supermarket-luthagens-livs-1004458/',
    'ICA Folkes Livs': '/erbjudanden/ica-folkes-livs-1004181/',
    'ICA Nära Hörnan': '/erbjudanden/ica-nara-hornan-1003672/',
  };
  const WEEKLY_OFFERS_LOADED = 2; // offers.weeklyOffersStatus: 0 NotLoaded, 1 Loading, 2 Loaded, 3 Error
  const ATTEMPTS = 3;

  if (location.hostname !== 'www.ica.se') {
    alert('Öppna en sida på www.ica.se och klicka på bokmärket där.');
    return;
  }
  const token = window.__UPPSALADEALS_ICA_TOKEN;
  if (!token) {
    alert('Bokmärket saknar nyckel. Skapa det på nytt.');
    return;
  }

  // A small panel in the corner shows the progress
  document.getElementById('uppsaladeals-ica')?.remove();
  const panel = document.createElement('div');
  panel.id = 'uppsaladeals-ica';
  panel.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;max-width:calc(100vw - 32px);'
    + 'background:#fff;color:#18181b;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);'
    + 'font:14px/1.45 system-ui,sans-serif;padding:14px 16px';
  panel.innerHTML = '<div style="font-weight:700;margin-bottom:8px">Uppsala Deals – ICA-erbjudanden</div><div id="uppsaladeals-ica-rows"></div>'
    + '<div id="uppsaladeals-ica-status" style="margin-top:10px;font-weight:600"></div>';
  document.body.appendChild(panel);
  const rows = panel.querySelector('#uppsaladeals-ica-rows');
  const status = panel.querySelector('#uppsaladeals-ica-status');
  const row = (name) => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
    el.innerHTML = `<span></span><span style="color:#71717a">hämtar…</span>`;
    el.firstChild.textContent = name;
    rows.appendChild(el);
    return (text, ok) => {
      el.lastChild.textContent = text;
      el.lastChild.style.color = ok ? '#15803d' : '#b91c1c';
    };
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The offers are in window.__INITIAL_DATA__ in the page's HTML. It is JavaScript, not
  // quite JSON, so the same fixes as in scrapers/ica.py are needed before parsing.
  function weeklyOffers(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const script = [...doc.scripts].find((s) => s.textContent.includes('window.__INITIAL_DATA__'));
    const match = script && script.textContent.match(/window\.__INITIAL_DATA__\s*=\s*(\{[\s\S]*\});?/);
    if (!match) throw new Error('sidan saknar data');
    const data = JSON.parse(match[1].replace(/;\s*$/, '')
      .replace(/:\s*undefined/g, ':null')
      .replace(/new\s+Map\(\[[\s\S]*?\]\)/g, '{}'));
    const offers = data.offers || {};
    const weekly = offers.weeklyOffers || [];
    if (!weekly.length && offers.weeklyOffersStatus !== WEEKLY_OFFERS_LOADED) {
      throw new Error('erbjudandena laddades inte');
    }
    return weekly;
  }

  const stores = {};
  for (const [name, path] of Object.entries(STORES)) {
    const show = row(name);
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await fetch(path, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        stores[name] = weeklyOffers(await response.text());
        show(`${stores[name].length} st`, true);
        break;
      } catch (err) {
        if (attempt === ATTEMPTS) show(err.message, false);
        else await sleep(2000);
      }
    }
    await sleep(400); // one page at a time, like a person clicking through the stores
  }

  if (!Object.keys(stores).length) {
    status.textContent = 'Inga butiker kunde hämtas – inget laddades upp.';
    status.style.color = '#b91c1c';
    return;
  }

  status.textContent = 'Laddar upp…';
  try {
    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stores })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const total = Object.values(stores).reduce((sum, offers) => sum + offers.length, 0);
    status.style.color = '#15803d';
    status.textContent = `Klart! ${total} erbjudanden uppladdade. `
      + (result.build === 'started'
        ? 'Sajten uppdateras om några minuter.'
        : 'De syns på sajten efter nattens uppdatering.');
  } catch (err) {
    status.style.color = '#b91c1c';
    status.textContent = `Uppladdningen misslyckades: ${err.message}`;
  }
})();
