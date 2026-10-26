export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// "a,b,c" -> unique, non-empty values, at most `max`
export function listParam(url, name, max) {
  const values = (url.searchParams.get(name) || '').split(',').map(v => v.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, max);
}

// Runs fn over items and keeps going when single items fail
export async function settle(items, fn) {
  const results = await Promise.allSettled(items.map(fn));
  const ok = {};
  const errors = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') ok[items[i]] = result.value;
    else errors[items[i]] = String(result.reason?.message || result.reason);
  });
  return { ok, errors };
}
