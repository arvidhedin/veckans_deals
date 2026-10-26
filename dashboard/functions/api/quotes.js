// GET /api/quotes?ids=avanza:stock:5269,avanza:fund:878733&fx=USD
// -> latest price per instrument plus exchange rates (SEK per unit) for their currencies
import { quote, fxQuote } from '../../lib/avanza.js';
import { json, listParam, settle } from '../../lib/http.js';

// Workers on the free plan allow 50 outgoing requests (cache lookups included) per call,
// so the page asks for at most 10 instruments at a time
const MAX_IDS = 12;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const ids = listParam(url, 'ids', MAX_IDS);
  const quotes = await settle(ids, quote);

  const currencies = new Set(listParam(url, 'fx', 8).map(c => c.toUpperCase()));
  Object.values(quotes.ok).forEach(q => currencies.add(q.currency));
  currencies.delete('SEK');
  const fx = await settle([...currencies], fxQuote);

  return json({
    quotes: quotes.ok,
    fx: { SEK: { rate: 1, prevClose: 1 }, ...fx.ok },
    errors: { ...quotes.errors, ...fx.errors },
    at: Date.now()
  });
}
