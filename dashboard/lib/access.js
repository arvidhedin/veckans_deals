// Checks that a request has passed Cloudflare Access (Zero Trust).
//
// Access already blocks visitors at dashboard.uppsaladeals.se, but the same Pages project is
// also reachable at <project>.pages.dev. Verifying Access's signed JWT here means the API
// never hands out the portfolio without a valid login, whichever address is used.
//
// Environment variables (Pages project -> Settings -> Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  e.g. "uppsaladeals.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   ALLOWED_EMAILS      optional, comma separated; extra check on top of the Access policy
//   DEV_NO_AUTH         "1" skips the check, only on localhost (local development)

let cachedKeys = null; // { teamDomain, keys, fetchedAt }

function base64UrlDecode(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

async function signingKeys(teamDomain, forceRefresh) {
  const fresh = cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < 3600 * 1000;
  if (fresh && !forceRefresh) return cachedKeys.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs HTTP ${response.status}`);
  const { keys } = await response.json();
  cachedKeys = { teamDomain, keys: keys || [], fetchedAt: Date.now() };
  return cachedKeys.keys;
}

function tokenFromRequest(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') || '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match ? match[1] : null;
}

export async function verifyAccess(request, env) {
  const { hostname } = new URL(request.url);
  if (env.DEV_NO_AUTH === '1' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return { ok: true, email: 'dev@localhost' };
  }

  const teamDomain = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!teamDomain || !env.ACCESS_AUD) {
    return { ok: false, status: 500, error: 'Cloudflare Access är inte konfigurerat (ACCESS_TEAM_DOMAIN / ACCESS_AUD saknas).' };
  }

  const token = tokenFromRequest(request);
  if (!token) return { ok: false, status: 401, error: 'Inte inloggad.' };

  try {
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);

    let jwk = (await signingKeys(teamDomain)).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await signingKeys(teamDomain, true)).find(k => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') return { ok: false, status: 401, error: 'Ogiltig inloggning.' };

    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    );
    if (!valid) return { ok: false, status: 401, error: 'Ogiltig inloggning.' };

    const now = Math.floor(Date.now() / 1000);
    const audiences = [].concat(payload.aud || []);
    if (payload.iss !== `https://${teamDomain}` || !audiences.includes(env.ACCESS_AUD)) {
      return { ok: false, status: 403, error: 'Inloggningen gäller inte den här sidan.' };
    }
    if (!payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 60)) {
      return { ok: false, status: 401, error: 'Inloggningen har gått ut.' };
    }

    const email = (payload.email || '').toLowerCase();
    const allowed = (env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) {
      return { ok: false, status: 403, error: 'Den här mejladressen har inte åtkomst.' };
    }
    return { ok: true, email };
  } catch (err) {
    console.warn('Access check failed:', err);
    return { ok: false, status: 401, error: 'Ogiltig inloggning.' };
  }
}
