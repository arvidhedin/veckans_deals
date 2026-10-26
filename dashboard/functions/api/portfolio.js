// GET /api/portfolio  -> { data, version }
// PUT /api/portfolio  { baseVersion, data } -> { version }
//
// The whole portfolio (instruments + transactions) is one JSON document in the KV namespace
// bound as PORTFOLIO. `version` guards against overwriting changes made on another device:
// a save based on an old version gets 409 and the page reloads before trying again.
import { json } from '../../lib/http.js';

const KEY = 'portfolio';
const MAX_BYTES = 1024 * 1024;
const BACKUP_DAYS = 60;

const EMPTY = { instruments: {}, transactions: [] };

async function load(env) {
  const stored = await env.PORTFOLIO.get(KEY, 'json');
  return stored || { version: 0, data: EMPTY };
}

function isValid(data) {
  return data && typeof data === 'object' && !Array.isArray(data)
    && data.instruments && typeof data.instruments === 'object' && !Array.isArray(data.instruments)
    && Array.isArray(data.transactions)
    && (data.cash === undefined || Array.isArray(data.cash));
}

export async function onRequestGet({ env, data: requestData }) {
  if (!env.PORTFOLIO) return json({ error: 'KV-namnrymden PORTFOLIO är inte kopplad till projektet.' }, 500);
  const { version, data } = await load(env);
  return json({ version, data, email: requestData.email });
}

export async function onRequestPut({ request, env }) {
  if (!env.PORTFOLIO) return json({ error: 'KV-namnrymden PORTFOLIO är inte kopplad till projektet.' }, 500);

  const body = await request.text();
  if (body.length > MAX_BYTES) return json({ error: 'För mycket data.' }, 413);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: 'Ogiltig JSON.' }, 400);
  }
  if (!isValid(parsed.data)) return json({ error: 'Ogiltigt portföljformat.' }, 400);

  const current = await load(env);
  if (parsed.baseVersion !== current.version) {
    return json({ error: 'Portföljen har ändrats på en annan enhet.', version: current.version, data: current.data }, 409);
  }

  const next = { version: current.version + 1, updatedAt: new Date().toISOString(), data: parsed.data };
  await env.PORTFOLIO.put(KEY, JSON.stringify(next));
  // One backup per day (the day's last save), kept for two months
  const day = next.updatedAt.slice(0, 10);
  await env.PORTFOLIO.put(`backup:${day}`, JSON.stringify(next), { expirationTtl: BACKUP_DAYS * 86400 });

  return json({ version: next.version });
}
