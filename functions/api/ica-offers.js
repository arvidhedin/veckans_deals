// Cloudflare Pages Function: ICA's weekly offers, uploaded from a real browser.
// Endpoint: https://uppsaladeals.se/api/ica-offers
//
// Since 2026-10-28 ica.se answers every scripted request with 403 (Akamai), so the nightly
// scraper can no longer fetch the store pages. Instead a bookmarklet run on ica.se
// (public/ica-export.js) reads the stores' offer pages in the user's own browser and POSTs
// them here. The nightly build (scrapers/ica.py) reads them back with GET.
//
// Setup (once) in the Pages project `veckans-deals`:
//   - KV binding ICA_OFFERS
//   - secret ICA_UPLOAD_TOKEN: the token the bookmarklet sends, so nobody else can upload
//   - secret GITHUB_TOKEN (optional): fine-grained token with "Actions: read and write" on
//     the repo; starts the "Scrape Offers and Deploy Data" workflow right after an upload

const KV_KEY = 'weekly';
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_ORIGIN = 'https://www.ica.se';
const REPO = 'arvidhedin/veckans_deals';
const WORKFLOW = 'scrape_and_deploy.yml';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS }
  });
}

// Compares the tokens without leaking how much of them matched through the timing
function sameToken(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function startBuild(env) {
  if (!env.GITHUB_TOKEN) return 'not configured';
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'uppsaladeals-ica-upload'
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );
    return response.ok ? 'started' : `failed (HTTP ${response.status})`;
  } catch (err) {
    return `failed (${err.message})`;
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env }) {
  const stored = await env.ICA_OFFERS.get(KV_KEY);
  return stored
    ? new Response(stored, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    : json({ uploaded_at: null, stores: {} });
}

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.ICA_UPLOAD_TOKEN || !sameToken(auth, `Bearer ${env.ICA_UPLOAD_TOKEN}`)) {
    return json({ error: 'Fel eller saknad nyckel' }, 401);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'För stor uppladdning' }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const stores = body && body.stores;
  if (!stores || typeof stores !== 'object' || Array.isArray(stores)
      || !Object.values(stores).every(Array.isArray)) {
    return json({ error: 'Väntade {stores: {butik: [erbjudanden]}}' }, 400);
  }

  // A store whose page failed this time keeps its offers from the previous upload
  const previous = JSON.parse((await env.ICA_OFFERS.get(KV_KEY)) || '{"stores":{}}');
  const merged = { ...previous.stores };
  for (const [name, offers] of Object.entries(stores)) {
    if (offers.length > 0) merged[name] = offers;
  }

  const counts = Object.fromEntries(Object.entries(stores).map(([name, offers]) => [name, offers.length]));
  await env.ICA_OFFERS.put(KV_KEY, JSON.stringify({ uploaded_at: new Date().toISOString(), stores: merged }));

  return json({ ok: true, counts, build: await startBuild(env) });
}
