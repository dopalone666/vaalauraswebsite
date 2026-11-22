import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiOrAuthRequest, type WorkerEnv } from '../../worker';
import { openPayloadWeb, sealPayloadWeb } from './webTokens';

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

function createMemoryKv() {
  const map = new Map<string, string>();
  return {
    async get(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
}

async function loginAsDeveloper(env: WorkerEnv): Promise<string> {
  const res = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dopalone@proton.me',
        password: 'test-only-ephemeral-dev-pass',
      }),
    }),
    env
  );
  assert.ok(res);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { bearerToken: string };
  return json.bearerToken;
}

test('GET /api/content/changelogs and /api/content/guides are publicly readable', async () => {
  const env = makeBaseEnv();
  const changelogRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/changelogs'),
    env
  );
  assert.ok(changelogRes);
  assert.equal(changelogRes.status, 200);
  const changelogJson = (await changelogRes.json()) as {
    posts: unknown[];
    storageReady: boolean;
  };
  assert.ok(changelogJson.posts.length >= 1);
  assert.equal(changelogJson.storageReady, false);

  const guideRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/guides'),
    env
  );
  assert.ok(guideRes);
  assert.equal(guideRes.status, 200);
  const guideJson = (await guideRes.json()) as {
    articles: unknown[];
    storageReady: boolean;
  };
  assert.ok(guideJson.articles.length >= 1);
  assert.equal(guideJson.storageReady, false);
});

test('Guide & Changelog mutations reject unauthenticated (401) and non-developer (403) callers', async () => {
  const env = makeBaseEnv({ CONTENT_KV: createMemoryKv() });

  const unauthRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/changelogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'v1.1.0', body: '## Core\n- Update' }),
    }),
    env
  );
  assert.ok(unauthRes);
  assert.equal(unauthRes.status, 401);

  // Regular Twitch subscriber session must receive 403
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'sub-token' }), { status: 200 });
    }
    if (url.startsWith('https://api.twitch.tv/helix/users')) {
      return new Response(
        JSON.stringify({ data: [{ id: '888', login: 'regularsub', display_name: 'RegularSub' }] }),
        { status: 200 }
      );
    }
    if (url.startsWith('https://api.twitch.tv/helix/subscriptions/user')) {
      return new Response(
        JSON.stringify({ data: [{ broadcaster_id: '99999999', tier: '1000', is_gift: false }] }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const urlRes = await handleApiOrAuthRequest(
      new Request('https://vaalauras.example.workers.dev/api/auth/twitch/url'),
      env
    );
    const { url } = (await urlRes!.json()) as { url: string };
    const stateToken = new URL(url).searchParams.get('state')!;
    const cbRes = await handleApiOrAuthRequest(
      new Request(
        `https://vaalauras.example.workers.dev/auth/twitch/callback?code=c&state=${encodeURIComponent(stateToken)}`
      ),
      env
    );
    const html = await cbRes!.text();
    const authCode = html.match(/"authCode":"([^"]+)"/)![1];
    const claimRes = await handleApiOrAuthRequest(
      new Request('https://vaalauras.example.workers.dev/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode }),
      }),
      env
    );
    const { bearerToken: subToken } = (await claimRes!.json()) as { bearerToken: string };

    const forbiddenGuideRes = await handleApiOrAuthRequest(
      new Request('https://vaalauras.example.workers.dev/api/content/guides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${subToken}`,
        },
        body: JSON.stringify({ title: 'Unauthorized', body: 'Should fail' }),
      }),
      env
    );
    assert.ok(forbiddenGuideRes);
    assert.equal(forbiddenGuideRes.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Developer mutations return 503 when CONTENT_KV is unbound and persist CRUD when KV is bound', async () => {
  const unboundEnv = makeBaseEnv();
  const unboundDevToken = await loginAsDeveloper(unboundEnv);
  const missingKvRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/changelogs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${unboundDevToken}`,
      },
      body: JSON.stringify({ version: 'v1.1.0', body: '## Core\n- Item' }),
    }),
    unboundEnv
  );
  assert.ok(missingKvRes);
  assert.equal(missingKvRes.status, 503);

  const env = makeBaseEnv({ CONTENT_KV: createMemoryKv() });
  const devToken = await loginAsDeveloper(env);

  // Changelog POST -> PUT -> DELETE
  const createPostRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/changelogs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({
        version: 'v1.1.0',
        category: 'Core',
        publishedAt: '23 November 2026',
        summary: 'Performance polish.',
        body: '## Overlays\n- Faster frame timing.',
      }),
    }),
    env
  );
  assert.ok(createPostRes);
  assert.equal(createPostRes.status, 201);
  const createdPost = (await createPostRes.json()) as { post: { id: string; version: string } };
  assert.equal(createdPost.post.version, 'v1.1.0');

  const updatePostRes = await handleApiOrAuthRequest(
    new Request(
      `https://vaalauras.example.workers.dev/api/content/changelogs/${createdPost.post.id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${devToken}`,
        },
        body: JSON.stringify({
          version: 'v1.1.1',
          category: 'Hotfix',
          publishedAt: '23 November 2026',
          summary: 'Updated notes.',
          body: '## Hotfix\n- Fixed crash.',
        }),
      }
    ),
    env
  );
  assert.ok(updatePostRes);
  assert.equal(updatePostRes.status, 200);
  const updatedPost = (await updatePostRes.json()) as { post: { version: string; category: string } };
  assert.equal(updatedPost.post.version, 'v1.1.1');
  assert.equal(updatedPost.post.category, 'Hotfix');

  const delPostRes = await handleApiOrAuthRequest(
    new Request(
      `https://vaalauras.example.workers.dev/api/content/changelogs/${createdPost.post.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${devToken}` },
      }
    ),
    env
  );
  assert.ok(delPostRes);
  assert.equal(delPostRes.status, 200);

  // Guide POST -> PUT -> DELETE
  const createGuideRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/content/guides', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({
        title: 'Custom Sound Alerts',
        topic: 'Overlays',
        summary: 'How to wire custom audio cues.',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        body: '## Setup\n- Pick a wav file.',
      }),
    }),
    env
  );
  assert.ok(createGuideRes);
  assert.equal(createGuideRes.status, 201);
  const createdGuide = (await createGuideRes.json()) as {
    article: { id: string; youtubeUrl: string | null };
  };
  assert.equal(createdGuide.article.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const updateGuideRes = await handleApiOrAuthRequest(
    new Request(`https://vaalauras.example.workers.dev/api/content/guides/${createdGuide.article.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({
        title: 'Custom Sound Alerts v2',
        topic: 'Audio',
        summary: 'Updated summary.',
        youtubeUrl: 'https://www.youtube.com/watch?v=abc123XYZ_9',
        body: '## Setup\n- Pick an ogg or wav file.',
      }),
    }),
    env
  );
  assert.ok(updateGuideRes);
  assert.equal(updateGuideRes.status, 200);
  const updatedGuide = (await updateGuideRes.json()) as {
    article: { title: string; topic: string; youtubeUrl: string };
  };
  assert.equal(updatedGuide.article.title, 'Custom Sound Alerts v2');
  assert.equal(updatedGuide.article.topic, 'Audio');
  assert.equal(updatedGuide.article.youtubeUrl, 'https://www.youtube.com/watch?v=abc123XYZ_9');

  const delGuideRes = await handleApiOrAuthRequest(
    new Request(`https://vaalauras.example.workers.dev/api/content/guides/${createdGuide.article.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${devToken}` },
    }),
    env
  );
  assert.ok(delGuideRes);
  assert.equal(delGuideRes.status, 200);
});

test('Login sets 24-hour HttpOnly session cookie, restores session on reload, protects mutations against CSRF, and logs out cleanly', async () => {
  const env = makeBaseEnv();
  const beforeSec = Math.floor(Date.now() / 1000);

  const loginRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dopalone@proton.me',
        password: 'test-only-ephemeral-dev-pass',
      }),
    }),
    env
  );
  assert.ok(loginRes);
  assert.equal(loginRes.status, 200);

  const setCookieHeader = loginRes.headers.get('set-cookie') || '';
  assert.match(setCookieHeader, /vaal_session=/);
  assert.match(setCookieHeader, /Max-Age=86400/);
  assert.match(setCookieHeader, /Expires=/);
  assert.match(setCookieHeader, /HttpOnly/);
  assert.match(setCookieHeader, /Secure/);
  assert.match(setCookieHeader, /SameSite=Lax/);

  const cookiePair = setCookieHeader.split(';')[0];
  const loginJson = (await loginRes.json()) as { expiresAt: string; expiresInSeconds: number };
  assert.equal(loginJson.expiresInSeconds, 86400);
  const expSec = Math.floor(Date.parse(loginJson.expiresAt) / 1000);
  assert.ok(expSec >= beforeSec + 86390 && expSec <= beforeSec + 86410);

  // Embedded iframe requests receive SameSite=None; Partitioned for preview compatibility
  const embeddedLoginRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/developer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Embedded-Frame': '1' },
      body: JSON.stringify({
        email: 'dopalone@proton.me',
        password: 'test-only-ephemeral-dev-pass',
      }),
    }),
    env
  );
  assert.ok(embeddedLoginRes);
  const embeddedCookie = embeddedLoginRes.headers.get('set-cookie') || '';
  assert.match(embeddedCookie, /SameSite=None/);
  assert.match(embeddedCookie, /Partitioned/);

  // Page reload hydrates session from HttpOnly cookie
  const sessionRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session', {
      headers: { Cookie: cookiePair },
    }),
    env
  );
  assert.ok(sessionRes);
  assert.equal(sessionRes.status, 200);
  const sessionJson = (await sessionRes.json()) as {
    bearerToken: string;
    user: { provider: string };
    expiresAt: string;
  };
  assert.equal(sessionJson.user.provider, 'developer');
  assert.ok(sessionJson.bearerToken.length > 20);
  assert.equal(sessionJson.expiresAt, loginJson.expiresAt);

  // Cookie-only POST without X-Requested-With or matching Origin is rejected (CSRF guard)
  const csrfBlockedRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/recheck', {
      method: 'POST',
      headers: { Cookie: cookiePair },
    }),
    env
  );
  assert.ok(csrfBlockedRes);
  assert.equal(csrfBlockedRes.status, 401);

  // Cookie POST with X-Requested-With preserves original 24-hour login window
  const recheckRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/recheck', {
      method: 'POST',
      headers: { Cookie: cookiePair, 'X-Requested-With': 'VaalAuras' },
    }),
    env
  );
  assert.ok(recheckRes);
  assert.equal(recheckRes.status, 200);
  const recheckJson = (await recheckRes.json()) as { expiresAt: string };
  assert.equal(recheckJson.expiresAt, loginJson.expiresAt);

  // Logout revokes token & clears vaal_session cookie
  const logoutRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookiePair, 'X-Requested-With': 'VaalAuras' },
    }),
    env
  );
  assert.ok(logoutRes);
  assert.equal(logoutRes.status, 200);
  const logoutCookies = logoutRes.headers.getSetCookie
    ? logoutRes.headers.getSetCookie().join(' | ')
    : logoutRes.headers.get('set-cookie') || '';
  assert.match(logoutCookies, /vaal_session=;.*Max-Age=0/);

  // Subsequent session check reports authenticated: false, reason: 'revoked', and clears stale cookie
  const afterLogoutRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session?_=' + Date.now(), {
      headers: { Cookie: cookiePair },
    }),
    env
  );
  assert.ok(afterLogoutRes);
  assert.equal(afterLogoutRes.status, 200);
  assert.match(afterLogoutRes.headers.get('cache-control') || '', /no-store/);
  assert.match(afterLogoutRes.headers.get('vary') || '', /Cookie/);
  const afterLogoutJson = (await afterLogoutRes.json()) as {
    authenticated: boolean;
    reason?: string;
  };
  assert.equal(afterLogoutJson.authenticated, false);
  assert.equal(afterLogoutJson.reason, 'revoked');
  assert.match(afterLogoutRes.headers.get('set-cookie') || '', /vaal_session=;.*Max-Age=0/);
});

test('Expired session (>24h old) is rejected with reason=expired and clears vaal_session cookie', async () => {
  const env = makeBaseEnv();
  const pastSec = Math.floor(Date.now() / 1000) - 90000; // 25 hours ago
  const expiredToken = await sealPayloadWeb(
    {
      user: {
        id: 'dev:dopalone',
        provider: 'developer',
        username: 'dopalone',
        displayName: 'Developer',
        avatarUrl: null,
      },
      entitlement: {
        active: true,
        provider: 'developer',
        tierCode: 'developer',
        tierLabel: 'Developer',
        reason: 'Developer account verified.',
        checkedAt: new Date(pastSec * 1000).toISOString(),
      },
      providerAccessToken: null,
      isDemo: false,
      sessionExpiresAt: pastSec + 86400,
    },
    TEST_SIGNING_SECRET,
    'session',
    86400,
    pastSec
  );

  const res = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session?_=' + Date.now(), {
      headers: { Cookie: `vaal_session=${encodeURIComponent(expiredToken)}` },
    }),
    env
  );
  assert.ok(res);
  assert.equal(res.status, 200);
  const resJson = (await res.json()) as { authenticated: boolean; reason?: string };
  assert.equal(resJson.authenticated, false);
  assert.equal(resJson.reason, 'expired');
  assert.match(res.headers.get('set-cookie') || '', /vaal_session=;.*Max-Age=0/);

  // Protected routes strictly reject the expired session with 401
  const protectedRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/license/issue', {
      method: 'POST',
      headers: {
        Cookie: `vaal_session=${encodeURIComponent(expiredToken)}`,
        'X-Requested-With': 'VaalAuras',
      },
    }),
    env
  );
  assert.ok(protectedRes);
  assert.equal(protectedRes.status, 401);
});

test('OAuth claim sets compact HttpOnly session cookie (<2KB) and persists across page refresh; missing/invalid cookies return clear reasons', async () => {
  const env = makeBaseEnv();

  // Unauthenticated without cookie
  const noCookieRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session?_=' + Date.now()),
    env
  );
  assert.ok(noCookieRes);
  assert.equal(noCookieRes.status, 200);
  const noCookieJson = (await noCookieRes.json()) as { authenticated: boolean; reason?: string };
  assert.equal(noCookieJson.authenticated, false);
  assert.equal(noCookieJson.reason, 'no_cookie');

  // Invalid cookie token
  const badCookieRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session', {
      headers: { Cookie: 'vaal_session=corrupted-token-value' },
    }),
    env
  );
  assert.ok(badCookieRes);
  assert.equal(badCookieRes.status, 200);
  const badCookieJson = (await badCookieRes.json()) as { authenticated: boolean; reason?: string };
  assert.equal(badCookieJson.authenticated, false);
  assert.equal(badCookieJson.reason, 'invalid_token');

  // Sealed OAuth claim -> POST /api/auth/claim -> cookie -> GET /api/auth/session
  const claimCode = await sealPayloadWeb(
    {
      user: {
        id: 'patreon:123456',
        provider: 'patreon',
        username: 'ExileSupporter',
        displayName: 'Exile Supporter',
        avatarUrl: 'https://c10.patreonusercontent.com/4/avatar.jpg',
      },
      entitlement: {
        active: true,
        provider: 'patreon',
        tierCode: 'patreon_tier',
        tierLabel: '$5.00 Tier',
        reason: 'Active Patreon tier verified.',
        checkedAt: new Date().toISOString(),
      },
      providerAccessToken: 'patreon-oauth-access-token-example',
      isDemo: false,
    },
    TEST_SIGNING_SECRET,
    'auth_claim',
    600
  );

  const claimRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Embedded-Frame': '0' },
      body: JSON.stringify({ authCode: claimCode }),
    }),
    env
  );
  assert.ok(claimRes);
  assert.equal(claimRes.status, 200);
  const setCookie = claimRes.headers.get('set-cookie') || '';
  assert.match(setCookie, /vaal_session=/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);

  const cookiePair = setCookie.split(';')[0];
  assert.ok(
    cookiePair.length < 2048,
    `Expected session cookie pair to be < 2048 bytes, got ${cookiePair.length}`
  );

  const restoredRes = await handleApiOrAuthRequest(
    new Request('https://vaalauras.example.workers.dev/api/auth/session?_=' + Date.now(), {
      headers: { Cookie: cookiePair },
    }),
    env
  );
  assert.ok(restoredRes);
  assert.equal(restoredRes.status, 200);
  const restoredJson = (await restoredRes.json()) as {
    authenticated: boolean;
    user: { id: string; provider: string };
    entitlement: { active: boolean };
    expiresInSeconds: number;
  };
  assert.equal(restoredJson.authenticated, true);
  assert.equal(restoredJson.user.id, 'patreon:123456');
  assert.equal(restoredJson.user.provider, 'patreon');
  assert.equal(restoredJson.entitlement.active, true);
  assert.ok(restoredJson.expiresInSeconds > 86300);
});



