// tools/etl/hsp.js — HSP client for historical service performance data.
// Consumes NROD credentials (Basic Auth), queries the HSP REST API,
// and caches results by (from,to,date) key in R2 or an in-memory Map.
// Rate-cap aware: sleeps 60 s on HTTP 429 and retries.

const BASE = process.env.HSP_ENDPOINT || 'https://hsp-prod.rockshore.net/api/v1';

export function hspClient({ user, pass, cache = new Map() }) {
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function post(path, body) {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(60_000);
      return post(path, body);
    }
    if (!res.ok) throw new Error(`HSP ${path}: HTTP ${res.status}`);
    return res.json();
  }

  return {
    async metrics(from, to, date, hhmm) {
      const key = `metrics|${from}|${to}|${date}|${hhmm}`;
      if (cache.has(key)) return cache.get(key);
      const out = await post('serviceMetrics', {
        from_loc: from,
        to_loc: to,
        from_time: hhmm,
        to_time: hhmm,
        from_date: date,
        to_date: date,
      });
      cache.set(key, out);
      return out;
    },
    async details(rid) {
      const key = `details|${rid}`;
      if (cache.has(key)) return cache.get(key);
      const out = await post('serviceDetails', { rid });
      cache.set(key, out);
      return out;
    },
    close() {},
  };
}
