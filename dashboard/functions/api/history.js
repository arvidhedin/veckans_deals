// GET /api/history?ids=avanza:stock:5269&fx=USD&period=one_year
// -> closing prices per instrument and exchange rate, for the graph
import { history, fxHistory, PERIODS } from '../../lib/avanza.js';
import { json, listParam, settle } from '../../lib/http.js';

const MAX_IDS = 12;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const period = url.searchParams.get('period');
  if (!PERIODS.includes(period)) return json({ error: 'Okänd period' }, 400);

  const ids = listParam(url, 'ids', MAX_IDS);
  const currencies = listParam(url, 'fx', 8).map(c => c.toUpperCase()).filter(c => c !== 'SEK');
  const [series, fx] = await Promise.all([
    settle(ids, id => history(id, period)),
    settle(currencies, c => fxHistory(c, period))
  ]);
  return json({ series: series.ok, fx: fx.ok, errors: { ...series.errors, ...fx.errors } });
}
