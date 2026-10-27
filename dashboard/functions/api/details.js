// GET /api/details?ids=avanza:fund:1509082,avanza:stock:5247
// -> countries, sectors, largest holdings, category and fee per instrument, for the analysis tab
import { details } from '../../lib/avanza.js';
import { json, listParam, settle } from '../../lib/http.js';

const MAX_IDS = 12;

export async function onRequestGet({ request }) {
  const ids = listParam(new URL(request.url), 'ids', MAX_IDS);
  const result = await settle(ids, details);
  return json({ details: result.ok, errors: result.errors });
}
