import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest, type WorkerEnv, type KVNamespaceLike } from '../../worker';

function makeKv(): KVNamespaceLike {
  const map = new Map<string, string>();
  return {
    async get(k) {
      return map.get(k) ?? null;
    },
    async put(k, v) {
      map.set(k, v);
    },
  };
}

const env = (): WorkerEnv => ({
  SESSION_SIGNING_SECRET: 'x'.repeat(40),
  DEV_LOGIN_EMAIL: 'Dev@Example.com',
  DEV_LOGIN_PASSWORD: 'hunter2',
  CONTENT_KV: makeKv(),
});

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request('https://site.test' + path, {
    ...init,
    headers: {
      'X-Requested-With': 'VaalAuras',
      'Content-Type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
  });

async function login(e: WorkerEnv): Promise<string> {
  const res = (await handleApiRequest(
    req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'dev@example.com', password: 'hunter2' }),
    }),
    e
  ))!;
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie')!;
  return setCookie.split(';')[0];
}

test('wrong password is rejected, correct login sets session', async () => {
  const e = env();
  const bad = (await handleApiRequest(
    req('/api/login', { method: 'POST', body: JSON.stringify({ email: 'dev@example.com', password: 'nope' }) }),
    e
  ))!;
  assert.equal(bad.status, 401);

  const cookie = await login(e);
  const session = (await handleApiRequest(req('/api/session', { cookie }), e))!;
  assert.equal((await session.json()).developer, true);

  const anon = (await handleApiRequest(req('/api/session'), e))!;
  assert.equal((await anon.json()).developer, false);
});

test('only the developer can edit the site; public can read', async () => {
  const e = env();
  const body = JSON.stringify({
    title: 'T',
    headline: 'H',
    buttons: [{ label: 'Download', url: 'https://example.com/a.zip', style: 'primary' }],
  });

  const denied = (await handleApiRequest(req('/api/site', { method: 'PUT', body }), e))!;
  assert.equal(denied.status, 401);

  const cookie = await login(e);
  const saved = (await handleApiRequest(req('/api/site', { method: 'PUT', body, cookie }), e))!;
  assert.equal(saved.status, 200);

  const pub = (await handleApiRequest(req('/api/site'), e))!;
  const data = await pub.json();
  assert.equal(data.site.title, 'T');
  assert.equal(data.site.buttons[0].url, 'https://example.com/a.zip');
});

test('mutations without the custom header are blocked even with a valid cookie', async () => {
  const e = env();
  const cookie = await login(e);
  const res = (await handleApiRequest(
    new Request('https://site.test/api/site', {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    }),
    e
  ))!;
  assert.equal(res.status, 403);
});

test('guide and changelog CRUD requires developer', async () => {
  const e = env();
  const payload = JSON.stringify({ title: 'A', body: 'text' });
  const anon = (await handleApiRequest(req('/api/content/guides', { method: 'POST', body: payload }), e))!;
  assert.equal(anon.status, 401);

  const cookie = await login(e);
  const created = (await handleApiRequest(req('/api/content/guides', { method: 'POST', body: payload, cookie }), e))!;
  assert.equal(created.status, 201);
  const { article } = await created.json();

  const del = (await handleApiRequest(req(`/api/content/guides/${article.id}`, { method: 'DELETE', cookie }), e))!;
  assert.equal(del.status, 200);
});

test('media upload requires developer, validates format signatures, and supports Range requests', async () => {
  const e = env();
  // Minimal valid MP4 header ("ftypisom")
  const mp4Bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  ]);

  const unauth = (await handleApiRequest(
    new Request('https://site.test/api/media', {
      method: 'POST',
      headers: { 'X-Requested-With': 'VaalAuras', 'Content-Type': 'video/mp4' },
      body: mp4Bytes,
    }),
    e
  ))!;
  assert.equal(unauth.status, 401);

  const cookie = await login(e);

  const spoofed = (await handleApiRequest(
    new Request('https://site.test/api/media', {
      method: 'POST',
      headers: { cookie, 'X-Requested-With': 'VaalAuras', 'Content-Type': 'video/mp4' },
      body: new TextEncoder().encode('<script>alert(1)</script>'),
    }),
    e
  ))!;
  assert.equal(spoofed.status, 400);

  const uploaded = (await handleApiRequest(
    new Request('https://site.test/api/media', {
      method: 'POST',
      headers: { cookie, 'X-Requested-With': 'VaalAuras', 'Content-Type': 'video/mp4' },
      body: mp4Bytes,
    }),
    e
  ))!;
  assert.equal(uploaded.status, 201);
  const meta = await uploaded.json();
  assert.equal(meta.mediaType, 'video');
  assert.match(meta.url, /^\/api\/media\/med-[a-f0-9]+\.mp4$/);

  const full = (await handleApiRequest(new Request('https://site.test' + meta.url), e))!;
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), mp4Bytes);

  const partial = (await handleApiRequest(
    new Request('https://site.test' + meta.url, { headers: { Range: 'bytes=4-7' } }),
    e
  ))!;
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 4-7/${mp4Bytes.byteLength}`);
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), mp4Bytes.subarray(4, 8));
});
