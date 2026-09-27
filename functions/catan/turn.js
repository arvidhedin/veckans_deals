// Cloudflare Pages Function: short-lived TURN credentials for Catan (Cloudflare Realtime TURN)
// Endpoint: https://uppsaladeals.se/catan/turn
//
// TURN relays the game traffic when two phones can't connect directly to each other,
// which is common on mobile data. Setup (once): create a TURN key in the Cloudflare
// dashboard (Realtime -> TURN Server) and add TURN_KEY_ID and TURN_KEY_API_TOKEN as
// environment variables in the Pages project. Without them this returns no servers
// and the game connects with STUN only, as before.

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function iceServersResponse(iceServers, status = 200) {
  return new Response(JSON.stringify({ iceServers }), { status, headers: JSON_HEADERS });
}

export async function onRequest({ request, env }) {
  // Only hand out credentials to the game on this site
  const siteOrigin = new URL(request.url).origin;
  const caller = request.headers.get('Origin') || request.headers.get('Referer') || '';
  if (caller && !caller.startsWith(siteOrigin)) {
    return iceServersResponse([], 403);
  }

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return iceServersResponse([]);
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl: 86400 })
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    // Port 53 is blocked by browsers and only makes connecting slower
    const iceServers = [].concat(data.iceServers || [])
      .map(server => ({ ...server, urls: [].concat(server.urls || []).filter(url => !/:53(\?|$)/.test(url)) }))
      .filter(server => server.urls.length > 0);

    return iceServersResponse(iceServers);
  } catch (err) {
    console.warn('TURN credentials error:', err);
    return iceServersResponse([], 502);
  }
}
