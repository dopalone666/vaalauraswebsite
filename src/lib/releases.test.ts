import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clearReleaseLookupCacheForTests, handleApiRequest, type WorkerEnv } from '../../worker';
import { PUBLISHED_RELEASE_INDEX } from '../generated/releaseIndex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const APPROVED_ASSETS = new Set([
  'VaalAurasSetup.exe',
  'VaalAurasSetup-linux-x86_64.sh',
  'vaalauras-update-manifest.json',
  'vaalauras-code-win-x64.tar.gz',
  'vaalauras-code-linux-x64.tar.gz',
  'vaalauras-assets.pak',
]);

test('static public/api/releases/latest is valid JSON restricted to approved assets', async () => {
  const raw = await readFile(path.join(ROOT, 'public', 'api', 'releases', 'latest'), 'utf8');
  const data = JSON.parse(raw) as {
    ok: boolean;
    version: string;
    tag: string;
    assets: Array<{ name: string; size: number; downloadUrl: string }>;
  };
  assert.equal(data.ok, true);
  assert.match(data.tag, /^v\d+\.\d+\.\d+/);
  assert.ok(data.assets.length >= 1 && data.assets.length <= 6);
  for (const a of data.assets) {
    assert.ok(APPROVED_ASSETS.has(a.name), `Unexpected static asset: ${a.name}`);
    assert.ok(
      a.downloadUrl.startsWith(`https://vaalauras.com/api/releases/download/${encodeURIComponent(data.tag)}/`),
      `Unexpected downloadUrl: ${a.downloadUrl}`
    );
  }
  const indexed = PUBLISHED_RELEASE_INDEX[data.tag];
  assert.ok(indexed, `Missing server-side asset index for ${data.tag}`);
  for (const a of data.assets) {
    assert.ok(indexed[a.name]?.id > 0, `Missing server-side asset ID for ${data.tag}/${a.name}`);
  }
});

test('GET /api/releases/latest returns 503 when GITHUB_RELEASES_TOKEN is missing', async () => {
  const req = new Request('https://vaalauras.com/api/releases/latest');
  const res = await handleApiRequest(req, {});
  assert.ok(res);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, false);
});

test('GET /api/releases/latest filters to allowlisted assets and never leaks token', async () => {
  const originalFetch = globalThis.fetch;
  let seenAuth = '';
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seenAuth = headers.get('authorization') || '';
    return new Response(
      JSON.stringify({
        tag_name: 'v1.0.3',
        name: 'VaalAuras v1.0.3',
        published_at: '2026-11-28T11:50:49Z',
        body: 'Update notes',
        assets: [
          { name: 'VaalAurasSetup.exe', size: 70000000 },
          { name: 'vaalauras-code-win-x64.tar.gz', size: 4200000 },
          { name: 'vaalauras-assets.pak', size: 32000000 },
          { name: 'secret-source.zip', size: 999 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const env: WorkerEnv = { GITHUB_RELEASES_TOKEN: 'ghp_super_secret_test' };
    const res = await handleApiRequest(new Request('https://vaalauras.com/api/releases/latest'), env);
    assert.ok(res);
    assert.equal(res.status, 200);
    assert.equal(seenAuth, 'Bearer ghp_super_secret_test');
    const text = await res.text();
    assert.ok(!text.includes('ghp_super_secret_test'));
    const data = JSON.parse(text) as {
      ok: boolean;
      version: string;
      tag: string;
      assets: Array<{ name: string; downloadUrl: string }>;
    };
    assert.equal(data.ok, true);
    assert.equal(data.version, '1.0.3');
    assert.equal(data.tag, 'v1.0.3');
    assert.deepEqual(
      data.assets.map((a) => a.name),
      ['VaalAurasSetup.exe', 'vaalauras-code-win-x64.tar.gz', 'vaalauras-assets.pak']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/releases/download uses server-side indexed asset ID and hands off 302 directly to GitHub', async () => {
  clearReleaseLookupCacheForTests();
  const env: WorkerEnv = { GITHUB_RELEASES_TOKEN: 'ghp_super_secret_test' };

  // Disallowed asset name must be rejected immediately with 0 upstream fetches.
  const blocked = await handleApiRequest(
    new Request('https://vaalauras.com/api/releases/download/v1.0.3/source.zip'),
    env
  );
  assert.ok(blocked);
  assert.equal(blocked.status, 404);

  const indexedAsset = PUBLISHED_RELEASE_INDEX['v1.0.3']?.['vaalauras-code-win-x64.tar.gz'];
  assert.ok(indexedAsset && indexedAsset.id > 0);

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; auth: string | null; accept: string | null; redirect?: RequestRedirect }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url: u,
      auth: headers.get('authorization'),
      accept: headers.get('accept'),
      redirect: init?.redirect,
    });
    if (u.endsWith(`/releases/assets/${indexedAsset.id}`)) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://objects.githubusercontent.com/signed-temp-download?sig=abc' },
      });
    }
    throw new Error(`Unexpected upstream fetch (expected zero release lookup): ${u}`);
  }) as typeof fetch;

  try {
    const res = await handleApiRequest(
      new Request('https://vaalauras.com/api/releases/download/v1.0.3/vaalauras-code-win-x64.tar.gz'),
      env
    );
    assert.ok(res);
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get('location'),
      'https://objects.githubusercontent.com/signed-temp-download?sig=abc'
    );
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    // Exactly ONE GitHub API call (direct asset ID lookup, no /releases/tags/ call, no file streaming!).
    assert.equal(calls.length, 1);
    assert.equal(calls[0].auth, 'Bearer ghp_super_secret_test');
    assert.equal(calls[0].accept, 'application/octet-stream');
    assert.equal(calls[0].redirect, 'manual');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/releases/download falls back to streaming on 200 and rejects draft releases on unindexed tags', async () => {
  clearReleaseLookupCacheForTests();
  const env: WorkerEnv = { GITHUB_RELEASES_TOKEN: 'ghp_super_secret_test' };
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    if (u.includes('/releases/tags/v9.9.9-draft')) {
      return new Response(
        JSON.stringify({
          draft: true,
          assets: [{ id: 555, name: 'vaalauras-code-win-x64.tar.gz', size: 4 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('/releases/tags/v9.9.9')) {
      return new Response(
        JSON.stringify({
          draft: false,
          assets: [
            { id: 777, name: 'vaalauras-code-win-x64.tar.gz', content_type: 'application/gzip', size: 4 },
            { id: 888, name: 'evil.zip', content_type: 'application/zip', size: 99 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.endsWith('/releases/assets/777')) {
      return new Response(new Uint8Array([9, 8, 7, 6]), {
        status: 200,
        headers: { 'Content-Type': 'application/gzip', 'Content-Length': '4' },
      });
    }
    throw new Error(`Unexpected URL: ${u}`);
  }) as typeof fetch;

  try {
    const draftRes = await handleApiRequest(
      new Request('https://vaalauras.com/api/releases/download/v9.9.9-draft/vaalauras-code-win-x64.tar.gz'),
      env
    );
    assert.ok(draftRes);
    assert.equal(draftRes.status, 404);

    const streamRes = await handleApiRequest(
      new Request('https://vaalauras.com/api/releases/download/v9.9.9/vaalauras-code-win-x64.tar.gz'),
      env
    );
    assert.ok(streamRes);
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual([...new Uint8Array(await streamRes.arrayBuffer())], [9, 8, 7, 6]);

    // Second request for v9.9.9 hits isolate cache — no repeat /releases/tags/v9.9.9 fetch!
    calls.length = 0;
    const cachedRes = await handleApiRequest(
      new Request('https://vaalauras.com/api/releases/download/v9.9.9/vaalauras-code-win-x64.tar.gz'),
      env
    );
    assert.ok(cachedRes);
    assert.equal(cachedRes.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/releases/assets/777'));
  } finally {
    globalThis.fetch = originalFetch;
    clearReleaseLookupCacheForTests();
  }
});
