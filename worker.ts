import {
  evaluatePatreonMembership,
  evaluateTwitchSubscription,
} from './src/lib/entitlement';
import {
  buildAppLaunchUrl,
  buildLocalhostCallbackUrl,
  openPayloadWeb,
  randomHex,
  sanitizeLocalhostPort,
  sanitizeProtocolScheme,
  sealPayloadWeb,
  signLicenseTokenWeb,
  verifyLicenseTokenWeb,
} from './src/lib/webTokens';
import type {
  AuthProvider,
  EntitlementResult,
  PublicAppConfig,
  VerifiedUser,
} from './src/types';

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  APP_URL?: string;
  APP_NAME?: string;
  CREATOR_DISPLAY_NAME?: string;
  APP_PROTOCOL_SCHEME?: string;
  APP_LOCALHOST_PORT?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  TWITCH_BROADCASTER_ID?: string;
  TWITCH_CHANNEL_LOGIN?: string;
  PATREON_CLIENT_ID?: string;
  PATREON_CLIENT_SECRET?: string;
  PATREON_MIN_TIER_CENTS?: string;
  PATREON_CAMPAIGN_ID?: string;
  PATREON_TIER_ID?: string;
  PATREON_CREATOR_URL?: string;
  SESSION_SIGNING_SECRET?: string;
  ASSETS?: AssetsBindingLike;
  AUTH_KV?: KVNamespaceLike;
}

interface SealedOAuthState extends Record<string, unknown> {
  nonce: string;
  provider: AuthProvider;
}

interface SealedClaimPayload extends Record<string, unknown> {
  user: VerifiedUser;
  entitlement: EntitlementResult;
  providerAccessToken: string | null;
  isDemo: boolean;
}

interface SealedSessionPayload extends Record<string, unknown> {
  user: VerifiedUser;
  entitlement: EntitlementResult;
  providerAccessToken: string | null;
  isDemo: boolean;
}

interface SealedHandoffPayload extends Record<string, unknown> {
  user: VerifiedUser;
  entitlement: EntitlementResult;
}

// Isolate-local bounded replay/revocation cache (complements optional AUTH_KV on Cloudflare)
const usedJtis = new Set<string>();
const MAX_LOCAL_JTI_CACHE = 5000;

function trackLocalJti(key: string): void {
  if (usedJtis.size >= MAX_LOCAL_JTI_CACHE) {
    const oldest = usedJtis.values().next().value;
    if (oldest) {
      usedJtis.delete(oldest);
    }
  }
  usedJtis.add(key);
}

async function isJtiConsumed(env: WorkerEnv, namespace: string, jti: string): Promise<boolean> {
  const key = `${namespace}:${jti}`;
  if (usedJtis.has(key)) {
    return true;
  }
  if (env.AUTH_KV) {
    const val = await env.AUTH_KV.get(key);
    if (val !== null) {
      trackLocalJti(key);
      return true;
    }
  }
  return false;
}

async function consumeJti(
  env: WorkerEnv,
  namespace: string,
  jti: string,
  ttlSeconds: number
): Promise<boolean> {
  const already = await isJtiConsumed(env, namespace, jti);
  if (already) {
    return false;
  }
  const key = `${namespace}:${jti}`;
  trackLocalJti(key);
  if (env.AUTH_KV) {
    await env.AUTH_KV.put(key, '1', { expirationTtl: Math.max(60, ttlSeconds) });
  }
  return true;
}

function getSigningSecret(env: WorkerEnv): string | null {
  const raw = (env.SESSION_SIGNING_SECRET || '').trim();
  if (raw.length >= 16) {
    return raw;
  }
  return null;
}

function resolveAppBaseUrl(request: Request, env: WorkerEnv): string {
  const configured = (env.APP_URL || '').trim();
  if (configured && configured !== 'MY_APP_URL' && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  return new URL(request.url).origin.replace(/\/+$/, '');
}

function getTwitchConfig(env: WorkerEnv) {
  const clientId = (env.TWITCH_CLIENT_ID || '').trim();
  const clientSecret = (env.TWITCH_CLIENT_SECRET || '').trim();
  const broadcasterId = (env.TWITCH_BROADCASTER_ID || '').trim();
  const channelLogin = (env.TWITCH_CHANNEL_LOGIN || '').trim();
  const configured = Boolean(clientId && clientSecret && broadcasterId);
  return { clientId, clientSecret, broadcasterId, channelLogin, configured };
}

function getPatreonConfig(env: WorkerEnv) {
  const clientId = (env.PATREON_CLIENT_ID || '').trim();
  const clientSecret = (env.PATREON_CLIENT_SECRET || '').trim();
  const campaignId = (env.PATREON_CAMPAIGN_ID || '').trim();
  const tierId = (env.PATREON_TIER_ID || '').trim();
  const creatorUrl = (env.PATREON_CREATOR_URL || '').trim();
  const parsedMin = Number.parseInt(env.PATREON_MIN_TIER_CENTS || '500', 10);
  const minTierCents = Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : 500;
  const configured = Boolean(clientId && clientSecret);
  return {
    clientId,
    clientSecret,
    campaignId,
    tierId,
    creatorUrl,
    minTierCents,
    configured,
  };
}

function getPublicConfig(request: Request, env: WorkerEnv): PublicAppConfig {
  const appBaseUrl = resolveAppBaseUrl(request, env);
  const twitch = getTwitchConfig(env);
  const patreon = getPatreonConfig(env);
  const signingConfigured = Boolean(getSigningSecret(env));

  return {
    appName: (env.APP_NAME || 'VaalAuras').trim() || 'VaalAuras',
    creatorDisplayName: (env.CREATOR_DISPLAY_NAME || 'VaalAuras').trim() || 'VaalAuras',
    protocolScheme: sanitizeProtocolScheme(env.APP_PROTOCOL_SCHEME),
    localhostPort: sanitizeLocalhostPort(env.APP_LOCALHOST_PORT),
    patreonMinTierCents: patreon.minTierCents,
    twitchConfigured: twitch.configured,
    patreonConfigured: patreon.configured,
    twitchCallbackUrl: `${appBaseUrl}/auth/twitch/callback`,
    patreonCallbackUrl: `${appBaseUrl}/auth/patreon/callback`,
    appBaseUrl,
    twitchChannelUrl: twitch.channelLogin
      ? `https://www.twitch.tv/${encodeURIComponent(twitch.channelLogin)}`
      : null,
    patreonCreatorUrl:
      patreon.creatorUrl && /^https?:\/\//i.test(patreon.creatorUrl)
        ? patreon.creatorUrl
        : null,
    signingConfigured,
  };
}

function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function htmlResponse(
  html: string,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) {
    return result;
  }
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const rawVal = part.slice(eqIndex + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(rawVal);
    } catch {
      result[name] = rawVal;
    }
  }
  return result;
}

function buildStateCookieHeader(request: Request, value: string, maxAge: number): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `vaal_oauth_state=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function renderPopupCallbackHtml(options: {
  ok: boolean;
  provider?: AuthProvider;
  authCode?: string;
  errorMessage?: string;
}): Response {
  const safeTitle = options.ok ? 'Verification Complete' : 'Login Issue';
  const safeBody = options.ok
    ? 'Returning you to VaalAuras...'
    : escapeHtml(options.errorMessage || 'Authentication failed.');

  const payloadJson = options.ok
    ? JSON.stringify({
        type: 'VAAL_AUTH_COMPLETE',
        authCode: options.authCode,
        provider: options.provider,
      }).replace(/</g, '\\u003c')
    : JSON.stringify({
        type: 'VAAL_AUTH_ERROR',
        error: options.errorMessage || 'Authentication failed.',
      }).replace(/</g, '\\u003c');

  const redirectTarget = options.ok
    ? `/?authCode=${encodeURIComponent(options.authCode || '')}`
    : `/?authError=${encodeURIComponent(options.errorMessage || 'Authentication failed.')}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle} — VaalAuras</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0D0A0B;
        color: #EFE6DC;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .card {
        max-width: 420px;
        margin: 24px;
        padding: 28px;
        border-radius: 10px;
        background: #161112;
        border: 1px solid #2D2224;
        text-align: center;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 1.15rem;
        color: ${options.ok ? '#D4A257' : '#FCA5A5'};
      }
      p {
        margin: 0 0 16px;
        font-size: 0.92rem;
        color: #A3948B;
        line-height: 1.5;
      }
      a {
        color: #D4A257;
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeBody}</p>
      <a href="${redirectTarget}">Continue to VaalAuras</a>
    </div>
    <script>
      (function () {
        var payload = ${payloadJson};
        if (window.opener) {
          try {
            window.opener.postMessage(payload, window.location.origin);
          } catch (_) {
            window.opener.postMessage(payload, '*');
          }
          setTimeout(function () { window.close(); }, 180);
        } else {
          window.location.replace(${JSON.stringify(redirectTarget)});
        }
      })();
    </script>
  </body>
</html>`;

  return htmlResponse(html, options.ok ? 200 : 400);
}

async function fetchTwitchUserAndSub(
  accessToken: string,
  env: WorkerEnv
): Promise<{ user: VerifiedUser; entitlement: EntitlementResult }> {
  const twitch = getTwitchConfig(env);
  if (!twitch.configured) {
    throw new Error('Twitch OAuth credentials are not configured.');
  }

  const userResp = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': twitch.clientId,
    },
  });

  if (!userResp.ok) {
    throw new Error(`Twitch user profile request failed (${userResp.status}).`);
  }

  const userJson = (await userResp.json()) as {
    data?: Array<{
      id: string;
      login: string;
      display_name: string;
      profile_image_url?: string;
    }>;
  };
  const twitchUser = userJson.data?.[0];
  if (!twitchUser) {
    throw new Error('Twitch returned an empty user profile.');
  }

  const subUrl = new URL('https://api.twitch.tv/helix/subscriptions/user');
  subUrl.searchParams.set('broadcaster_id', twitch.broadcasterId);
  subUrl.searchParams.set('user_id', twitchUser.id);

  const subResp = await fetch(subUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': twitch.clientId,
    },
  });

  let subBody: unknown = null;
  try {
    subBody = await subResp.json();
  } catch {
    subBody = null;
  }

  const entitlement = evaluateTwitchSubscription(
    subResp.status,
    subBody,
    twitch.broadcasterId
  );

  return {
    user: {
      id: `twitch:${twitchUser.id}`,
      provider: 'twitch',
      username: twitchUser.login,
      displayName: twitchUser.display_name || twitchUser.login,
      avatarUrl: twitchUser.profile_image_url || null,
    },
    entitlement,
  };
}

async function fetchPatreonUserAndMembership(
  accessToken: string,
  env: WorkerEnv
): Promise<{ user: VerifiedUser; entitlement: EntitlementResult }> {
  const patreon = getPatreonConfig(env);
  if (!patreon.configured) {
    throw new Error('Patreon OAuth credentials are not configured.');
  }

  const identityUrl = new URL('https://www.patreon.com/api/oauth2/v2/identity');
  identityUrl.searchParams.set(
    'include',
    'memberships,memberships.currently_entitled_tiers,memberships.campaign'
  );
  identityUrl.searchParams.set('fields[user]', 'full_name,email,image_url,vanity');
  identityUrl.searchParams.set(
    'fields[member]',
    'patron_status,currently_entitled_amount_cents,will_pay_amount_cents,last_charge_status'
  );
  identityUrl.searchParams.set('fields[tier]', 'title,amount_cents');

  const identityResp = await fetch(identityUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!identityResp.ok) {
    throw new Error(`Patreon identity request failed (${identityResp.status}).`);
  }

  const payload = (await identityResp.json()) as {
    data?: {
      id?: string;
      attributes?: {
        full_name?: string;
        vanity?: string;
        image_url?: string;
      };
    };
  };

  const patreonId = payload.data?.id;
  if (!patreonId) {
    throw new Error('Patreon returned an invalid user identity.');
  }

  const entitlement = evaluatePatreonMembership(payload, {
    minTierCents: patreon.minTierCents,
    requiredCampaignId: patreon.campaignId || undefined,
    requiredTierId: patreon.tierId || undefined,
  });

  const displayName =
    payload.data?.attributes?.full_name ||
    payload.data?.attributes?.vanity ||
    `Patron ${patreonId}`;
  const username = payload.data?.attributes?.vanity || displayName;

  return {
    user: {
      id: `patreon:${patreonId}`,
      provider: 'patreon',
      username,
      displayName,
      avatarUrl: payload.data?.attributes?.image_url || null,
    },
    entitlement,
  };
}

async function readBearerSession(
  request: Request,
  env: WorkerEnv
): Promise<{
  session: SealedSessionPayload;
  jti: string;
  signingSecret: string;
} | null> {
  const signingSecret = getSigningSecret(env);
  if (!signingSecret) {
    return null;
  }
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token || token.length > 8192) {
    return null;
  }

  const opened = await openPayloadWeb<SealedSessionPayload>(
    token,
    signingSecret,
    'session'
  );
  if (!opened.valid) {
    return null;
  }

  if (await isJtiConsumed(env, 'revoked_session', opened.data.jti)) {
    return null;
  }

  return {
    session: opened.data,
    jti: opened.data.jti,
    signingSecret,
  };
}

async function safeParseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleApiOrAuthRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  // 1. Public Portal Configuration
  if (method === 'GET' && pathname === '/api/config') {
    return jsonResponse(getPublicConfig(request, env));
  }

  // 2. Build Twitch OAuth URL
  if (method === 'GET' && pathname === '/api/auth/twitch/url') {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse(
        { error: 'SESSION_SIGNING_SECRET is not configured in Cloudflare Secrets yet.' },
        503
      );
    }
    const twitch = getTwitchConfig(env);
    if (!twitch.configured) {
      return jsonResponse(
        { error: 'Twitch OAuth is not configured yet. Add TWITCH_* secrets first.' },
        400
      );
    }

    const nonce = randomHex(16);
    const state = await sealPayloadWeb<SealedOAuthState>(
      { nonce, provider: 'twitch' },
      signingSecret,
      'oauth_state',
      600
    );

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id', twitch.clientId);
    authUrl.searchParams.set('redirect_uri', `${resolveAppBaseUrl(request, env)}/auth/twitch/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'user:read:subscriptions');
    authUrl.searchParams.set('state', state);

    return jsonResponse(
      { url: authUrl.toString() },
      200,
      { 'Set-Cookie': buildStateCookieHeader(request, nonce, 600) }
    );
  }

  // 3. Build Patreon OAuth URL
  if (method === 'GET' && pathname === '/api/auth/patreon/url') {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse(
        { error: 'SESSION_SIGNING_SECRET is not configured in Cloudflare Secrets yet.' },
        503
      );
    }
    const patreon = getPatreonConfig(env);
    if (!patreon.configured) {
      return jsonResponse(
        { error: 'Patreon OAuth is not configured yet. Add PATREON_* secrets first.' },
        400
      );
    }

    const nonce = randomHex(16);
    const state = await sealPayloadWeb<SealedOAuthState>(
      { nonce, provider: 'patreon' },
      signingSecret,
      'oauth_state',
      600
    );

    const authUrl = new URL('https://www.patreon.com/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', patreon.clientId);
    authUrl.searchParams.set('redirect_uri', `${resolveAppBaseUrl(request, env)}/auth/patreon/callback`);
    authUrl.searchParams.set('scope', 'identity identity.memberships');
    authUrl.searchParams.set('state', state);

    return jsonResponse(
      { url: authUrl.toString() },
      200,
      { 'Set-Cookie': buildStateCookieHeader(request, nonce, 600) }
    );
  }

  // 4. Twitch OAuth Callback
  if (method === 'GET' && (pathname === '/auth/twitch/callback' || pathname === '/auth/twitch/callback/')) {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Server signing key is not configured yet.',
      });
    }

    const code = url.searchParams.get('code');
    const rawState = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    const oauthErrorDesc = url.searchParams.get('error_description');

    if (oauthError) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: oauthErrorDesc || `Twitch authorization denied (${oauthError}).`,
      });
    }

    if (!code || !rawState) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Missing authorization code or state parameter.',
      });
    }

    const openedState = await openPayloadWeb<SealedOAuthState>(
      rawState,
      signingSecret,
      'oauth_state'
    );
    if (!openedState.valid || openedState.data.provider !== 'twitch') {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Login session expired or invalid CSRF state. Please try again.',
      });
    }

    const cookies = parseCookies(request.headers.get('cookie'));
    if (cookies.vaal_oauth_state && cookies.vaal_oauth_state !== openedState.data.nonce) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Login browser state mismatch. Please start login again.',
      });
    }

    const twitch = getTwitchConfig(env);
    if (!twitch.configured) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Twitch OAuth is not configured on this server.',
      });
    }

    try {
      const tokenBody = new URLSearchParams({
        client_id: twitch.clientId,
        client_secret: twitch.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${resolveAppBaseUrl(request, env)}/auth/twitch/callback`,
      });

      const tokenResp = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenResp.ok) {
        return renderPopupCallbackHtml({
          ok: false,
          errorMessage: 'Twitch declined the authorization code. Verify your Callback URL and secrets.',
        });
      }

      const tokenJson = (await tokenResp.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        return renderPopupCallbackHtml({
          ok: false,
          errorMessage: 'Twitch did not return an access token.',
        });
      }

      const { user, entitlement } = await fetchTwitchUserAndSub(tokenJson.access_token, env);
      const authCode = await sealPayloadWeb<SealedClaimPayload>(
        {
          user,
          entitlement,
          providerAccessToken: tokenJson.access_token,
          isDemo: false,
        },
        signingSecret,
        'auth_claim',
        600
      );

      const resp = renderPopupCallbackHtml({ ok: true, provider: 'twitch', authCode });
      resp.headers.set('Set-Cookie', buildStateCookieHeader(request, '', 0));
      return resp;
    } catch (err) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: err instanceof Error ? err.message : 'Twitch verification failed.',
      });
    }
  }

  // 5. Patreon OAuth Callback
  if (method === 'GET' && (pathname === '/auth/patreon/callback' || pathname === '/auth/patreon/callback/')) {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Server signing key is not configured yet.',
      });
    }

    const code = url.searchParams.get('code');
    const rawState = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: `Patreon authorization denied (${oauthError}).`,
      });
    }

    if (!code || !rawState) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Missing authorization code or state parameter.',
      });
    }

    const openedState = await openPayloadWeb<SealedOAuthState>(
      rawState,
      signingSecret,
      'oauth_state'
    );
    if (!openedState.valid || openedState.data.provider !== 'patreon') {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Login session expired or invalid CSRF state. Please try again.',
      });
    }

    const cookies = parseCookies(request.headers.get('cookie'));
    if (cookies.vaal_oauth_state && cookies.vaal_oauth_state !== openedState.data.nonce) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Login browser state mismatch. Please start login again.',
      });
    }

    const patreon = getPatreonConfig(env);
    if (!patreon.configured) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: 'Patreon OAuth is not configured on this server.',
      });
    }

    try {
      const tokenBody = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: patreon.clientId,
        client_secret: patreon.clientSecret,
        redirect_uri: `${resolveAppBaseUrl(request, env)}/auth/patreon/callback`,
      });

      const tokenResp = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenResp.ok) {
        return renderPopupCallbackHtml({
          ok: false,
          errorMessage: 'Patreon declined the authorization code. Verify your Redirect URI and secrets.',
        });
      }

      const tokenJson = (await tokenResp.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        return renderPopupCallbackHtml({
          ok: false,
          errorMessage: 'Patreon did not return an access token.',
        });
      }

      const { user, entitlement } = await fetchPatreonUserAndMembership(
        tokenJson.access_token,
        env
      );
      const authCode = await sealPayloadWeb<SealedClaimPayload>(
        {
          user,
          entitlement,
          providerAccessToken: tokenJson.access_token,
          isDemo: false,
        },
        signingSecret,
        'auth_claim',
        600
      );

      const resp = renderPopupCallbackHtml({ ok: true, provider: 'patreon', authCode });
      resp.headers.set('Set-Cookie', buildStateCookieHeader(request, '', 0));
      return resp;
    } catch (err) {
      return renderPopupCallbackHtml({
        ok: false,
        errorMessage: err instanceof Error ? err.message : 'Patreon verification failed.',
      });
    }
  }

  // 6. Claim Single-Use Auth Code into Bearer Session
  if (method === 'POST' && pathname === '/api/auth/claim') {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse({ error: 'Server signing secret is not configured.' }, 503);
    }

    const body = await safeParseJsonBody(request);
    const authCode = typeof body?.authCode === 'string' ? body.authCode.trim() : '';
    if (!authCode || authCode.length > 8192) {
      return jsonResponse({ error: 'Missing authCode.' }, 400);
    }

    const opened = await openPayloadWeb<SealedClaimPayload>(
      authCode,
      signingSecret,
      'auth_claim'
    );
    if (!opened.valid) {
      return jsonResponse({ error: 'Invalid or expired login handoff code.' }, 401);
    }

    const fresh = await consumeJti(env, 'auth_claim', opened.data.jti, 600);
    if (!fresh) {
      return jsonResponse({ error: 'This login handoff code was already claimed.' }, 401);
    }

    const bearerToken = await sealPayloadWeb<SealedSessionPayload>(
      {
        user: opened.data.user,
        entitlement: opened.data.entitlement,
        providerAccessToken: opened.data.providerAccessToken,
        isDemo: opened.data.isDemo,
      },
      signingSecret,
      'session',
      12 * 60 * 60
    );

    return jsonResponse({
      bearerToken,
      user: opened.data.user,
      entitlement: opened.data.entitlement,
      isDemo: opened.data.isDemo,
    });
  }

  // 7. Preview Sandbox (Strictly Disabled Whenever Live OAuth Secrets Exist)
  if (method === 'POST' && pathname === '/api/auth/demo') {
    const twitch = getTwitchConfig(env);
    const patreon = getPatreonConfig(env);
    if (twitch.configured || patreon.configured) {
      return jsonResponse(
        { error: 'Preview sandbox is disabled when live OAuth keys are configured.' },
        403
      );
    }

    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse(
        { error: 'SESSION_SIGNING_SECRET is not configured yet.' },
        503
      );
    }

    const body = await safeParseJsonBody(request);
    const scenario = typeof body?.scenario === 'string' ? body.scenario : '';
    const nowIso = new Date().toISOString();

    let user: VerifiedUser;
    let entitlement: EntitlementResult;

    if (scenario === 'twitch_active') {
      user = {
        id: 'twitch:demo-4410',
        provider: 'twitch',
        username: 'exile_watcher',
        displayName: 'ExileWatcher',
        avatarUrl: null,
      };
      entitlement = {
        active: true,
        provider: 'twitch',
        tierLabel: 'Tier 1 / Prime',
        tierCode: '1000',
        amountCents: null,
        isGift: false,
        reason: 'Active Tier 1 / Prime Twitch subscription verified (Preview Sandbox).',
        checkedAt: nowIso,
      };
    } else if (scenario === 'patreon_active') {
      user = {
        id: 'patreon:demo-8821',
        provider: 'patreon',
        username: 'vaal_patron',
        displayName: 'VaalPatron',
        avatarUrl: null,
      };
      entitlement = {
        active: true,
        provider: 'patreon',
        tierLabel: 'Vaal Supporter ($5.00/mo)',
        tierCode: 'tier_500',
        amountCents: 500,
        isGift: false,
        reason: 'Active Patreon membership verified at $5.00/mo (Preview Sandbox).',
        checkedAt: nowIso,
      };
    } else if (scenario === 'patreon_inactive') {
      user = {
        id: 'patreon:demo-1099',
        provider: 'patreon',
        username: 'free_follower',
        displayName: 'FreeFollower',
        avatarUrl: null,
      };
      entitlement = {
        active: false,
        provider: 'patreon',
        tierLabel: 'Tip Tier ($2.00/mo)',
        tierCode: 'tier_200',
        amountCents: 200,
        isGift: false,
        reason: 'Current Patreon pledge is $2.00/mo. At least the $5.00/mo tier is required to unlock VaalAuras.',
        checkedAt: nowIso,
      };
    } else {
      return jsonResponse({ error: 'Unknown sandbox scenario.' }, 400);
    }

    const bearerToken = await sealPayloadWeb<SealedSessionPayload>(
      {
        user,
        entitlement,
        providerAccessToken: null,
        isDemo: true,
      },
      signingSecret,
      'session',
      12 * 60 * 60
    );

    return jsonResponse({ bearerToken, user, entitlement, isDemo: true });
  }

  // 8. Current Session Info
  if (method === 'GET' && pathname === '/api/auth/session') {
    const auth = await readBearerSession(request, env);
    if (!auth) {
      return jsonResponse({ error: 'Not signed in.' }, 401);
    }
    return jsonResponse({
      user: auth.session.user,
      entitlement: auth.session.entitlement,
      isDemo: auth.session.isDemo,
    });
  }

  // 9. Re-check Live Subscription
  if (method === 'POST' && pathname === '/api/auth/recheck') {
    const auth = await readBearerSession(request, env);
    if (!auth) {
      return jsonResponse({ error: 'Not signed in.' }, 401);
    }

    const { session, signingSecret } = auth;
    let updatedUser = session.user;
    let updatedEntitlement = session.entitlement;

    if (session.isDemo) {
      updatedEntitlement = {
        ...session.entitlement,
        checkedAt: new Date().toISOString(),
      };
    } else if (!session.providerAccessToken) {
      return jsonResponse(
        { error: 'OAuth access token missing. Please sign in again.' },
        401
      );
    } else {
      try {
        if (session.user.provider === 'twitch') {
          const refreshed = await fetchTwitchUserAndSub(session.providerAccessToken, env);
          updatedUser = refreshed.user;
          updatedEntitlement = refreshed.entitlement;
        } else {
          const refreshed = await fetchPatreonUserAndMembership(session.providerAccessToken, env);
          updatedUser = refreshed.user;
          updatedEntitlement = refreshed.entitlement;
        }
      } catch (err) {
        return jsonResponse(
          {
            error:
              err instanceof Error
                ? err.message
                : 'Provider re-check failed. Please sign in again.',
          },
          401
        );
      }
    }

    const refreshedBearer = await sealPayloadWeb<SealedSessionPayload>(
      {
        user: updatedUser,
        entitlement: updatedEntitlement,
        providerAccessToken: session.providerAccessToken,
        isDemo: session.isDemo,
      },
      signingSecret,
      'session',
      12 * 60 * 60
    );

    return jsonResponse({
      bearerToken: refreshedBearer,
      user: updatedUser,
      entitlement: updatedEntitlement,
      isDemo: session.isDemo,
    });
  }

  // 10. Sign Out
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const auth = await readBearerSession(request, env);
    if (auth) {
      await consumeJti(env, 'revoked_session', auth.jti, 12 * 60 * 60);
    }
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': buildStateCookieHeader(request, '', 0) }
    );
  }

  // 11. Issue Desktop Handoff Code & Signed License (Requires entitlement.active === true)
  if (method === 'POST' && pathname === '/api/license/issue') {
    const auth = await readBearerSession(request, env);
    if (!auth) {
      return jsonResponse({ error: 'Sign in first before launching VaalAuras.' }, 401);
    }

    const { session, signingSecret } = auth;
    if (!session.entitlement.active) {
      return jsonResponse(
        {
          error:
            session.entitlement.reason ||
            'An active Twitch subscription or $5+ Patreon tier is required.',
        },
        403
      );
    }

    const codeTtlSeconds = 300;
    const licenseTtlSeconds = 7 * 24 * 60 * 60;
    const nowSec = Math.floor(Date.now() / 1000);

    const handoffCode = await sealPayloadWeb<SealedHandoffPayload>(
      {
        user: session.user,
        entitlement: session.entitlement,
      },
      signingSecret,
      'handoff_code',
      codeTtlSeconds,
      nowSec
    );

    const licenseToken = await signLicenseTokenWeb(
      {
        sub: session.user.id,
        provider: session.user.provider,
        username: session.user.username,
        tier: session.entitlement.tierLabel,
        entitled: true,
      },
      signingSecret,
      licenseTtlSeconds,
      nowSec
    );

    const scheme = sanitizeProtocolScheme(env.APP_PROTOCOL_SCHEME);
    const port = sanitizeLocalhostPort(env.APP_LOCALHOST_PORT);

    return jsonResponse({
      handoffCode,
      licenseToken,
      appLaunchUri: buildAppLaunchUrl(scheme, handoffCode),
      localhostCallbackUrl: buildLocalhostCallbackUrl(port, handoffCode),
      codeExpiresAt: new Date((nowSec + codeTtlSeconds) * 1000).toISOString(),
      expiresAt: new Date((nowSec + licenseTtlSeconds) * 1000).toISOString(),
    });
  }

  // 12. Python App Exchange Endpoint (Single-Use Code -> Signed License)
  if (method === 'POST' && pathname === '/api/app/exchange') {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse({ valid: false, error: 'Server signing secret is not configured.' }, 503);
    }

    const body = await safeParseJsonBody(request);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 8192) {
      return jsonResponse({ valid: false, error: 'Missing handoff code.' }, 400);
    }

    const opened = await openPayloadWeb<SealedHandoffPayload>(
      code,
      signingSecret,
      'handoff_code'
    );
    if (!opened.valid) {
      return jsonResponse({ valid: false, error: 'Invalid or expired handoff code.' }, 400);
    }

    if (!opened.data.entitlement?.active) {
      return jsonResponse({ valid: false, error: 'Entitlement is not active.' }, 403);
    }

    const fresh = await consumeJti(env, 'handoff_code', opened.data.jti, 300);
    if (!fresh) {
      return jsonResponse(
        {
          valid: false,
          error: 'This handoff code has already been used. Click Log in on the website to generate a fresh code.',
        },
        400
      );
    }

    const licenseTtlSeconds = 7 * 24 * 60 * 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const licenseToken = await signLicenseTokenWeb(
      {
        sub: opened.data.user.id,
        provider: opened.data.user.provider,
        username: opened.data.user.username,
        tier: opened.data.entitlement.tierLabel,
        entitled: true,
      },
      signingSecret,
      licenseTtlSeconds,
      nowSec
    );

    return jsonResponse({
      valid: true,
      licenseToken,
      user: opened.data.user,
      entitlement: opened.data.entitlement,
      expiresAt: new Date((nowSec + licenseTtlSeconds) * 1000).toISOString(),
    });
  }

  // 13. Python App License Token Verify Endpoint
  if (method === 'POST' && pathname === '/api/app/verify') {
    const signingSecret = getSigningSecret(env);
    if (!signingSecret) {
      return jsonResponse({ valid: false, error: 'Server signing secret is not configured.' }, 503);
    }

    const body = await safeParseJsonBody(request);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 8192) {
      return jsonResponse({ valid: false, error: 'Missing token.' }, 400);
    }

    const result = await verifyLicenseTokenWeb(token, signingSecret);
    if (!result.valid) {
      return jsonResponse({ valid: false, error: result.error }, 401);
    }
    return jsonResponse({ valid: true, claims: result.claims });
  }

  return null;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const handled = await handleApiOrAuthRequest(request, env);
    if (handled) {
      return handled;
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
