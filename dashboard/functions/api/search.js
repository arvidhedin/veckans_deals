// GET /api/search?q=volvo -> stocks, ETFs and funds matching the query
import { search } from '../../lib/avanza.js';
import { json } from '../../lib/http.js';

export async function onRequestGet({ request }) {
  const query = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
  if (query.length < 2) return json({ results: [] });
  try {
    return json({ results: await search(query) });
  } catch (err) {
    return json({ error: `Sökningen misslyckades: ${err.message}` }, 502);
  }
}
