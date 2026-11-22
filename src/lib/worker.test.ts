import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiOrAuthRequest, type WorkerEnv } from '../../worker';
import { openPayloadWeb } from './webTokens';

const TEST_SIGNING_SECRET = '0123456789abcdef0123456789abcdef';

function makeBaseEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    APP_URL: 'https://vaalauras.example.workers.dev',
    APP_PROTOCOL_SCHEME: 'vaalauras',
    APP_LOCALHOST_PORT: '48912',
    SESSION_SIGNING_SECRET: TEST_SIGNING_SECRET,
    TWITCH_CLIENT_ID: 'tw-client-id',
    TWITCH_CLIENT_SECRET: 'tw-client-secret',
    TWITCH_BROADCASTER_ID: '99999999',
    DEV_TWITCH_LOGINS: 'dopalonee',
    DEV_LOGIN_EMAIL: 'dopalone@proton.me',
    DEV_LOGIN_PASSWORD: 'test-only-ephemeral-dev-pass',
    ...overrides,
  };
}

test('GET /api/config exposes developerLoginConfigured and omits secrets', async () => {
  const env = makeBaseEnv();
  const req = new Request('https://vaalauras.example.workers.dev/api/config');
  const res = await handleApiOrAuthRequest(req, env);
  assert.ok(res);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.developerLoginConfigured, true);
  assert.equal(body.signingConfigured, true);
  assert.equal('DEV_LOGIN_PASSWORD' in body, false);
  assert.equal('SESSION_SIGNING_SECRET' in body, false);
});

test('POST /api/auth/demo is removed (returns null/404)', async () => {
  const env = makeBaseEnv();
  const req = new Request('https://vaalauras.example.workers.dev/api/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'twitch_active' }),
  });
  const res = await handleApiOrAuthRequest(req, env);
  assert.equal(res, null);
});

test('POST /api/auth/developer fails closed (503) when DEV_LOGIN_PASSWORD is unset', async () => {
  const env = makeBaseEnv({ DEV_LOGIN_PASSWORD: '' });
  const req = new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'dopalone@proton.me',
      password: 'any-password',
    }),
  });
  const res = await handleApiOrAuthRequest(req, env);
  assert.ok(res);
  assert.equal(res.status, 503);
});

test('POST /api/auth/developer rejects wrong credentials with 401', async () => {
  const env = makeBaseEnv();

  const badPass = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dopalone@proton.me',
        password: 'wrong-password',
      }),
    }),
    env
  );
  assert.ok(badPass);
  assert.equal(badPass.status, 401);

  const badEmail = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'someoneelse@proton.me',
        password: 'test-only-ephemeral-dev-pass',
      }),
    }),
    env
  );
  assert.ok(badEmail);
  assert.equal(badEmail.status, 401);
});

test('Developer email login -> license issue -> app exchange -> app verify grants permanent Developer tier', async () => {
  const env = makeBaseEnv();

  const loginRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '  DOPALONE@PROTON.ME ',
        password: 'test-only-ephemeral-dev-pass',
      }),
    }),
    env
  );
  assert.ok(loginRes);
  assert.equal(loginRes.status, 200);
  const loginJson = (await loginRes.json()) as {
    bearerToken: string;
    user: { provider: string; displayName: string };
    entitlement: { active: boolean; tierLabel: string; tierCode: string };
  };
  assert.equal(loginJson.user.provider, 'developer');
  assert.equal(loginJson.entitlement.active, true);
  assert.equal(loginJson.entitlement.tierLabel, 'Developer');
  assert.equal(loginJson.entitlement.tierCode, 'developer');

  const issueRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/license/issue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginJson.bearerToken}` },
    }),
    env
  );
  assert.ok(issueRes);
  assert.equal(issueRes.status, 200);
  const issueJson = (await issueRes.json()) as {
    handoffCode: string;
    appLaunchUri: string;
    localhostCallbackUrl: string;
  };
  assert.ok(issueJson.appLaunchUri.startsWith('vaalauras://auth?code='));
  assert.ok(issueJson.localhostCallbackUrl.startsWith('http://127.0.0.1:48912/callback?code='));

  const exchangeRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/app/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issueJson.handoffCode }),
    }),
    env
  );
  assert.ok(exchangeRes);
  assert.equal(exchangeRes.status, 200);
  const exchangeJson = (await exchangeRes.json()) as {
    valid: boolean;
    licenseToken: string;
    entitlement: { active: boolean; tierLabel: string };
  };
  assert.equal(exchangeJson.valid, true);
  assert.equal(exchangeJson.entitlement.active, true);
  assert.equal(exchangeJson.entitlement.tierLabel, 'Developer');

  const verifyRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/app/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: exchangeJson.licenseToken }),
    }),
    env
  );
  assert.ok(verifyRes);
  assert.equal(verifyRes.status, 200);
  const verifyJson = (await verifyRes.json()) as {
    valid: boolean;
    claims: { provider: string; tier: string; entitled: boolean };
  };
  assert.equal(verifyJson.valid, true);
  assert.equal(verifyJson.claims.provider, 'developer');
  assert.equal(verifyJson.claims.tier, 'Developer');
  assert.equal(verifyJson.claims.entitled, true);
});

test('Twitch OAuth recognizes dopalonee as permanent Developer without requiring a channel subscription', async () => {
  const env = makeBaseEnv();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'twitch-access-token-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://api.twitch.tv/helix/users')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '5551234',
              login: 'dopalonee',
              display_name: 'Dopalonee',
              profile_image_url: null,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.startsWith('https://api.twitch.tv/helix/subscriptions/user')) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;

  try {
    const urlRes = await handleApiOrAuthRequest(
      new Request('https://vaalauras.example.workers.dev/api/auth/twitch/url'),
      env
    );
    assert.ok(urlRes);
    const { url } = (await urlRes.json()) as { url: string };
    const stateToken = new URL(url).searchParams.get('state')!;
    const openedState = await openPayloadWeb<{ nonce: string }>(
      stateToken,
      TEST_SIGNING_SECRET,
      'oauth_state'
    );
    assert.equal(openedState.valid, true);
    const nonce = openedState.valid ? openedState.data.nonce : '';

    const cbReq = new Request(
      `https://vaalauras.example.workers.dev/auth/twitch/callback?code=tw-code-1&state=${encodeURIComponent(stateToken)}`,
      {
        headers: {
          Cookie: `vaal_oauth_state=${encodeURIComponent(nonce)}`,
        },
      }
    );
    const cbRes = await handleApiOrAuthRequest(cbReq, env);
    assert.ok(cbRes);
    assert.equal(cbRes.status, 200);
    const html = await cbRes.text();
    const match = html.match(/"authCode":"([^"]+)"/);
    assert.ok(match, 'Expected authCode in callback HTML payload');

    const claimRes = await handleApiOrAuthRequest(
      new Request('https://vaalauras.example.workers.dev/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode: match[1] }),
      }),
      env
    );
    assert.ok(claimRes);
    assert.equal(claimRes.status, 200);
    const claimJson = (await claimRes.json()) as {
      user: { provider: string; username: string };
      entitlement: { active: boolean; tierLabel: string; tierCode: string };
    };
    assert.equal(claimJson.user.provider, 'twitch');
    assert.equal(claimJson.user.username, 'dopalonee');
    assert.equal(claimJson.entitlement.active, true);
    assert.equal(claimJson.entitlement.tierLabel, 'Developer');
    assert.equal(claimJson.entitlement.tierCode, 'developer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
