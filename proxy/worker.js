// Cloudflare Worker that lets the Library app talk to MangaDex.
// MangaDex doesn't answer browser requests from other websites and blocks
// hot-linked images, so the app sends its requests here and this worker passes
// them on. It only forwards to MangaDex, and only for your app's address.
//
// Settings (Worker → Settings → Variables):
//   ALLOWED_ORIGIN  your app's address, e.g. https://your-name.github.io

const API = 'https://api.mangadex.org';
const UA = 'PersonalLibraryReader/1.0 (personal use; +https://github.com)';
const IMAGE_HOSTS = [/^uploads\.mangadex\.org$/, /\.mangadex\.network$/];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Expose-Headers': 'X-Cache, Retry-After',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    // Images are loaded by <img> tags, which don't always send Origin; check Referer for those.
    const referer = request.headers.get('Referer') || '';
    if (!okOrigin && !allowed.some((a) => referer.startsWith(`${a}/`))) {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/ping') return json({ ok: true }, cors);

      if (url.pathname.startsWith('/api/') && request.method === 'GET') {
        const target = API + url.pathname.slice(4) + url.search;
        const res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        return pass(res, cors, url.pathname.startsWith('/api/at-home') ? 'no-store' : 'public, max-age=300');
      }

      if (url.pathname === '/img' && request.method === 'GET') {
        const target = new URL(url.searchParams.get('u') || '');
        if (target.protocol !== 'https:' || !IMAGE_HOSTS.some((re) => re.test(target.hostname))) {
          return new Response('Not allowed', { status: 400, headers: cors });
        }
        const res = await fetch(target, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 86400 } });
        return pass(res, cors, 'public, max-age=604800');
      }

      if (url.pathname === '/report' && request.method === 'POST') {
        const body = await request.text();
        const res = await fetch('https://api.mangadex.network/report', {
          method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body,
        });
        return new Response(null, { status: res.ok ? 204 : 502, headers: cors });
      }

      return new Response('Not found', { status: 404, headers: cors });
    } catch (e) {
      return json({ error: String(e) }, cors, 502);
    }
  },
};

function pass(res, cors, cacheControl) {
  const headers = new Headers(cors);
  for (const h of ['Content-Type', 'X-Cache', 'Retry-After', 'Content-Length']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (res.ok) headers.set('Cache-Control', cacheControl);
  return new Response(res.body, { status: res.status, headers });
}

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
