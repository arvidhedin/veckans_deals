// Every /api request must come through Cloudflare Access (see lib/access.js)
import { verifyAccess } from '../../lib/access.js';
import { json } from '../../lib/http.js';

export async function onRequest(context) {
  const result = await verifyAccess(context.request, context.env);
  if (!result.ok) return json({ error: result.error }, result.status);
  context.data.email = result.email;
  return context.next();
}
