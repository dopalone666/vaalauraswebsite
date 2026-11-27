import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRequest, type WorkerEnv } from '../../worker';

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
        tag_name: 'v1.0.2',
        name: 'VaalAuras v1.0.2',
        published_at: '2026-11-27T20:00:00Z',
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
    assert.equal(data.version, '1.0.2');
    assert.equal(data.tag, 'v1.0.2');
    assert.deepEqual(
      data.assets.map((a) => a.name),
      ['VaalAurasSetup.exe', 'vaalauras-code-win-x64.tar.gz', 'vaalauras-assets.pak']
    );
    assert.equal(
      data.assets[1].downloadUrl,
      'https://vaalauras.com/api/releases/download/v1.0.2/vaalauras-code-win-x64.tar.gz'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/releases/download rejects disallowed assets and strips Authorization on S3 redirect', async () => {
  const env: WorkerEnv = { GITHUB_RELEASES_TOKEN: 'ghp_super_secret_test' };
  const blocked = await handleApiRequest(
    new Request('https://vaalauras.com/api/releases/download/v1.0.2/source.zip'),
    env
  );
  assert.ok(blocked);
  assert.equal(blocked.status, 404);

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; auth: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url: u, auth: headers.get('authorization') });
    if (u.includes('/releases/tags/v1.0.2')) {
      return new Response(
        JSON.stringify({
          assets: [
            {
              name: 'vaalauras-code-win-x64.tar.gz',
              url: 'https://api.github.com/repos/MayuzumiSayaka/cucky/releases/assets/123',
              content_type: 'application/gzip',
              size: 11,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('/releases/assets/123')) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://objects.githubusercontent.com/signed-download' },
      });
    }
    if (u === 'https://objects.githubusercontent.com/signed-download') {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'Content-Type': 'application/gzip', 'Content-Length': '4' },
      });
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  }) as typeof fetch;

  try {
    const res = await handleApiRequest(
      new Request('https://vaalauras.com/api/releases/download/v1.0.2/vaalauras-code-win-x64.tar.gz'),
      env
    );
    assert.ok(res);
    assert.equal(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].auth, 'Bearer ghp_super_secret_test');
    assert.equal(calls[1].auth, 'Bearer ghp_super_secret_test');
    assert.equal(calls[2].auth, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
