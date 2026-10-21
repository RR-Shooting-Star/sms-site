// 신락전야 괴담 피드 API — Cloudflare Pages Functions + D1(글·댓글) + R2(사진)
// 바인딩: D1 → 변수 이름 DB / R2 버킷 → 변수 이름 IMG / 환경 변수(Secret) → ADMIN_KEY
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const PER = 15, COOL = 15 * 1000, MAX_IMG = 4, MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

async function hashIP(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|sms-rumor'));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function tooFast(env, who) {
  const row = await env.DB.prepare('SELECT last FROM rate WHERE who = ?').bind(who).first();
  const now = Date.now();
  if (row && now - row.last < COOL) return true;
  await env.DB.prepare('INSERT INTO rate (who, last) VALUES (?, ?) ON CONFLICT(who) DO UPDATE SET last = excluded.last').bind(who, now).run();
  return false;
}
const isAdmin = (request, env) => !!env.ADMIN_KEY && request.headers.get('X-Admin-Key') === env.ADMIN_KEY;
const parseImgs = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };

export async function onRequest({ request, env, params }) {
  const path = '/' + [].concat(params.route || []).join('/');
  const method = request.method;
  try {
    if (path === '/ping') return json({ ok: true });

    if (path === '/admin' && method === 'POST') {
      const { key } = await request.json().catch(() => ({}));
      return json({ ok: !!env.ADMIN_KEY && key === env.ADMIN_KEY });
    }

    // 사진 보기
    let m = path.match(/^\/img\/([\w.-]+)$/);
    if (m && method === 'GET') {
      const obj = await env.IMG.get(m[1]);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, { headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable' } });
    }

    // 피드 (sort: random | new | top, random은 seed로 페이지 사이 순서 고정)
    if (path === '/posts' && method === 'GET') {
      const q = new URL(request.url).searchParams;
      const page = Math.max(1, parseInt(q.get('page')) || 1);
      const sort = ['random', 'new', 'top'].includes(q.get('sort')) ? q.get('sort') : 'random';
      const seed = Math.min(1000002, Math.max(200003, parseInt(q.get('seed')) || 400009));
      const order = sort === 'new' ? 'p.id DESC' : sort === 'top' ? '(p.likes - p.dislikes) DESC, p.id DESC' : `((p.id * ${seed}) % 1000003)`;
      const who = await hashIP(request);
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.body, p.name, p.images, p.created, p.likes, p.dislikes,
                (SELECT COUNT(*) FROM comments c WHERE c.post = p.id) AS comments,
                COALESCE((SELECT v FROM votes v WHERE v.post = p.id AND v.who = ?), 0) AS my
         FROM posts p ORDER BY ${order} LIMIT ? OFFSET ?`
      ).bind(who, PER + 1, (page - 1) * PER).all();
      return json({ posts: results.slice(0, PER).map(p => ({ ...p, images: parseImgs(p.images) })), more: results.length > PER });
    }

    // 좋아요 / 싫어요 (v: 1 | -1 | 0=취소), 한 사람당 글 하나에 한 표
    let mv = path.match(/^\/posts\/(\d+)\/vote$/);
    if (mv && method === 'POST') {
      const { v } = await request.json().catch(() => ({}));
      const nv = v === 1 ? 1 : v === -1 ? -1 : 0;
      const post = await env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(mv[1]).first();
      if (!post) return json({ error: '없는 글입니다' }, 404);
      const who = await hashIP(request);
      const old = (await env.DB.prepare('SELECT v FROM votes WHERE post = ? AND who = ?').bind(mv[1], who).first())?.v || 0;
      if (old !== nv) {
        const dl = (nv === 1) - (old === 1), dd = (nv === -1) - (old === -1);
        await env.DB.batch([
          nv ? env.DB.prepare('INSERT INTO votes (post, who, v) VALUES (?, ?, ?) ON CONFLICT(post, who) DO UPDATE SET v = excluded.v').bind(mv[1], who, nv)
             : env.DB.prepare('DELETE FROM votes WHERE post = ? AND who = ?').bind(mv[1], who),
          env.DB.prepare('UPDATE posts SET likes = likes + ?, dislikes = dislikes + ? WHERE id = ?').bind(dl, dd, mv[1]),
        ]);
      }
      const r = await env.DB.prepare('SELECT likes, dislikes FROM posts WHERE id = ?').bind(mv[1]).first();
      return json({ likes: r.likes, dislikes: r.dislikes, my: nv });
    }

    // 글 올리기 (multipart: body, name, images[])
    if (path === '/posts' && method === 'POST') {
      const form = await request.formData().catch(() => null);
      if (!form) return json({ error: '잘못된 요청입니다' }, 400);
      const body = clean(form.get('body'), 3000), name = clean(form.get('name'), 16);
      const files = form.getAll('images').filter(f => f && typeof f === 'object' && f.size).slice(0, MAX_IMG);
      if (!body && !files.length) return json({ error: '내용이나 사진을 넣어 주세요' }, 400);
      for (const f of files) {
        if (!TYPES[f.type]) return json({ error: '사진 파일만 올릴 수 있습니다' }, 400);
        if (f.size > MAX_BYTES) return json({ error: '사진 한 장은 5MB까지입니다' }, 400);
      }
      const who = await hashIP(request);
      if (await tooFast(env, who)) return json({ error: '조금 뒤에 다시 올려 주세요' }, 429);
      const keys = [];
      for (const f of files) {
        const key = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${TYPES[f.type]}`;
        await env.IMG.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
        keys.push(key);
      }
      const r = await env.DB.prepare('INSERT INTO posts (body, name, images, created, who) VALUES (?, ?, ?, ?, ?)')
        .bind(body, name, JSON.stringify(keys), Date.now(), who).run();
      return json({ id: r.meta.last_row_id });
    }

    // 글 삭제 (관리자)
    m = path.match(/^\/posts\/(\d+)$/);
    if (m && method === 'DELETE') {
      if (!isAdmin(request, env)) return json({ error: '관리자만 지울 수 있습니다' }, 403);
      const row = await env.DB.prepare('SELECT images FROM posts WHERE id = ?').bind(m[1]).first();
      if (row) { const keys = parseImgs(row.images); if (keys.length) await env.IMG.delete(keys); }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM comments WHERE post = ?').bind(m[1]),
        env.DB.prepare('DELETE FROM votes WHERE post = ?').bind(m[1]),
        env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(m[1]),
      ]);
      return json({ ok: true });
    }

    // 댓글
    m = path.match(/^\/posts\/(\d+)\/comments$/);
    if (m && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, body, name, created FROM comments WHERE post = ? ORDER BY id').bind(m[1]).all();
      return json({ comments: results });
    }
    if (m && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const body = clean(b.body, 500), name = clean(b.name, 16);
      if (!body) return json({ error: '댓글을 적어 주세요' }, 400);
      const exists = await env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(m[1]).first();
      if (!exists) return json({ error: '없는 글입니다' }, 404);
      const who = await hashIP(request);
      if (await tooFast(env, who)) return json({ error: '조금 뒤에 다시 달아 주세요' }, 429);
      await env.DB.prepare('INSERT INTO comments (post, body, name, created, who) VALUES (?, ?, ?, ?, ?)')
        .bind(m[1], body, name, Date.now(), who).run();
      return json({ ok: true });
    }

    m = path.match(/^\/comments\/(\d+)$/);
    if (m && method === 'DELETE') {
      if (!isAdmin(request, env)) return json({ error: '관리자만 지울 수 있습니다' }, 403);
      await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(m[1]).run();
      return json({ ok: true });
    }

    return json({ error: '없는 경로입니다' }, 404);
  } catch (e) {
    return json({ error: '서버 오류가 났습니다' }, 500);
  }
}
