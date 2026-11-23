import {
  DEFAULT_CHANGELOG_POSTS,
  DEFAULT_GUIDE_ARTICLES,
  slugifyTitle,
  validateChangelogInput,
  validateGuideInput,
} from './src/lib/content';
import { DEFAULT_SITE_SETTINGS, validateSiteInput } from './src/lib/site';
import {
  constantTimeEqualStringWeb,
  openPayloadWeb,
  randomHex,
  sealPayloadWeb,
} from './src/lib/webTokens';
import type { ChangelogPost, GuideArticle, SiteSettings } from './src/types';

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  DEV_LOGIN_EMAIL?: string;
  DEV_LOGIN_PASSWORD?: string;
  SESSION_SIGNING_SECRET?: string;
  ASSETS?: AssetsBindingLike;
  CONTENT_KV?: KVNamespaceLike;
}

const SESSION_COOKIE_NAME = 'vaal_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SITE_KV_KEY = 'content:site:v1';
const CHANGELOG_KV_KEY = 'content:changelogs:v1';
const GUIDE_KV_KEY = 'content:guides:v1';
const MAX_CONTENT_ITEMS = 100;

const KV_MISSING_ERROR =
  'Storage is not set up yet. Bind a KV namespace named CONTENT_KV in Cloudflare Worker Settings -> Bindings.';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function jsonResponse(
  body: unknown,
  status: number = 200,
  setCookies: string[] = []
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
  });
  for (const cookie of setCookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

function isHttps(request: Request): boolean {
  const forwarded = (request.headers.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwarded === 'https' || new URL(request.url).protocol === 'https:';
}

function buildSessionCookie(request: Request, value: string, maxAge: number): string {
  const age = Math.max(0, Math.floor(maxAge));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${age}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (age === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (isHttps(request)) parts.push('Secure');
  return parts.join('; ');
}

/** State-changing requests must carry the custom header (cannot be sent cross-site without CORS). */
function isMutationSafe(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return (request.headers.get('x-requested-with') || '').trim() === 'VaalAuras';
}

function getSigningSecret(env: WorkerEnv): string | null {
  const raw = (env.SESSION_SIGNING_SECRET || '').trim();
  return raw.length >= 16 ? raw : null;
}

function getDevConfig(env: WorkerEnv) {
  const email = (env.DEV_LOGIN_EMAIL || '').trim().toLowerCase();
  const password = env.DEV_LOGIN_PASSWORD || '';
  return { email, password, configured: Boolean(email && password) };
}

/* ------------------------------------------------------------------ */
/* Developer session                                                   */
/* ------------------------------------------------------------------ */

async function isDeveloper(request: Request, env: WorkerEnv): Promise<boolean> {
  const secret = getSigningSecret(env);
  if (!secret) return false;
  const token = (parseCookies(request.headers.get('cookie'))[SESSION_COOKIE_NAME] || '').trim();
  if (!token || token.length > 4096) return false;
  const opened = await openPayloadWeb<{ role: string }>(token, secret, 'session');
  return opened.valid && opened.data.role === 'developer';
}

async function requireDeveloper(
  request: Request,
  env: WorkerEnv
): Promise<Response | null> {
  if (!isMutationSafe(request)) {
    return jsonResponse({ error: 'Blocked request.' }, 403);
  }
  if (!(await isDeveloper(request, env))) {
    return jsonResponse({ error: 'Developer sign-in required.' }, 401);
  }
  return null;
}

// Isolate-local brute-force throttle for the login endpoint.
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_FAILURES = 6;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function isThrottled(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= MAX_LOGIN_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

/* ------------------------------------------------------------------ */
/* KV-backed content                                                   */
/* ------------------------------------------------------------------ */

async function loadJson<T>(env: WorkerEnv, key: string, fallback: T): Promise<T> {
  const kv = env.CONTENT_KV;
  if (!kv) return fallback;
  try {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadSite(env: WorkerEnv): Promise<SiteSettings> {
  const stored = await loadJson<Partial<SiteSettings> | null>(env, SITE_KV_KEY, null);
  if (!stored || typeof stored !== 'object') return DEFAULT_SITE_SETTINGS;
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...stored,
    socials: { ...DEFAULT_SITE_SETTINGS.socials, ...(stored.socials || {}) },
    buttons: Array.isArray(stored.buttons) ? stored.buttons : DEFAULT_SITE_SETTINGS.buttons,
    tags: Array.isArray(stored.tags) ? stored.tags : DEFAULT_SITE_SETTINGS.tags,
  };
}

async function loadChangelogs(env: WorkerEnv): Promise<ChangelogPost[]> {
  const data = await loadJson<unknown>(env, CHANGELOG_KV_KEY, DEFAULT_CHANGELOG_POSTS);
  return Array.isArray(data) ? (data as ChangelogPost[]) : DEFAULT_CHANGELOG_POSTS;
}

async function loadGuides(env: WorkerEnv): Promise<GuideArticle[]> {
  const data = await loadJson<unknown>(env, GUIDE_KV_KEY, DEFAULT_GUIDE_ARTICLES);
  return Array.isArray(data) ? (data as GuideArticle[]) : DEFAULT_GUIDE_ARTICLES;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export async function handleApiRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith('/api/')) return null;

  /* ---- Auth: developer login only ---- */

  if (method === 'GET' && pathname === '/api/session') {
    const dev = getDevConfig(env);
    return jsonResponse({
      developer: await isDeveloper(request, env),
      loginConfigured: dev.configured && Boolean(getSigningSecret(env)),
      storageReady: Boolean(env.CONTENT_KV),
    });
  }

  if (method === 'POST' && pathname === '/api/login') {
    if (!isMutationSafe(request)) return jsonResponse({ error: 'Blocked request.' }, 403);

    const secret = getSigningSecret(env);
    const dev = getDevConfig(env);
    if (!secret || !dev.configured) {
      return jsonResponse(
        {
          error:
            'Login is not configured. Set SESSION_SIGNING_SECRET, DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD as Worker secrets.',
        },
        503
      );
    }

    const key = clientKey(request);
    if (isThrottled(key)) {
      return jsonResponse({ error: 'Too many failed attempts. Try again in a few minutes.' }, 429);
    }

    const body = await readJsonBody(request);
    const email = (typeof body?.email === 'string' ? body.email : '').trim().toLowerCase();
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password || email.length > 256 || password.length > 256) {
      return jsonResponse({ error: 'Enter your email and password.' }, 400);
    }

    const [emailOk, passwordOk] = await Promise.all([
      constantTimeEqualStringWeb(email, dev.email),
      constantTimeEqualStringWeb(password, dev.password),
    ]);
    if (!emailOk || !passwordOk) {
      recordFailure(key);
      return jsonResponse({ error: 'Invalid email or password.' }, 401);
    }

    loginFailures.delete(key);
    const token = await sealPayloadWeb({ role: 'developer' }, secret, 'session', SESSION_TTL_SECONDS);
    return jsonResponse({ ok: true, developer: true }, 200, [
      buildSessionCookie(request, token, SESSION_TTL_SECONDS),
    ]);
  }

  if (method === 'POST' && pathname === '/api/logout') {
    return jsonResponse({ ok: true }, 200, [buildSessionCookie(request, '', 0)]);
  }

  /* ---- Home page settings ---- */

  if (method === 'GET' && pathname === '/api/site') {
    return jsonResponse({ site: await loadSite(env), storageReady: Boolean(env.CONTENT_KV) });
  }

  if (method === 'PUT' && pathname === '/api/site') {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const validated = validateSiteInput(await readJsonBody(request), () => `btn-${randomHex(4)}`);
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const site: SiteSettings = { ...validated.data, updatedAt: new Date().toISOString() };
    await env.CONTENT_KV.put(SITE_KV_KEY, JSON.stringify(site));
    return jsonResponse({ site });
  }

  /* ---- Changelog ---- */

  if (method === 'GET' && pathname === '/api/content/changelogs') {
    return jsonResponse({
      posts: await loadChangelogs(env),
      storageReady: Boolean(env.CONTENT_KV),
    });
  }

  if (method === 'POST' && pathname === '/api/content/changelogs') {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const validated = validateChangelogInput(await readJsonBody(request));
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const existing = await loadChangelogs(env);
    if (existing.length >= MAX_CONTENT_ITEMS) {
      return jsonResponse({ error: 'Maximum number of changelog posts reached.' }, 400);
    }

    const now = new Date().toISOString();
    const post: ChangelogPost = {
      id: `rel-${randomHex(8)}`,
      ...validated.data,
      createdAt: now,
      updatedAt: now,
    };
    const posts = [post, ...existing];
    await env.CONTENT_KV.put(CHANGELOG_KV_KEY, JSON.stringify(posts));
    return jsonResponse({ post, posts }, 201);
  }

  const changelogMatch = pathname.match(/^\/api\/content\/changelogs\/([a-zA-Z0-9_-]{1,64})$/);
  if (changelogMatch && (method === 'PUT' || method === 'DELETE')) {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const id = changelogMatch[1];
    const existing = await loadChangelogs(env);
    const idx = existing.findIndex((p) => p.id === id);
    if (idx === -1) return jsonResponse({ error: 'Changelog post not found.' }, 404);

    if (method === 'DELETE') {
      const posts = existing.filter((p) => p.id !== id);
      await env.CONTENT_KV.put(CHANGELOG_KV_KEY, JSON.stringify(posts));
      return jsonResponse({ ok: true, posts });
    }

    const validated = validateChangelogInput(await readJsonBody(request));
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const post: ChangelogPost = {
      ...existing[idx],
      ...validated.data,
      updatedAt: new Date().toISOString(),
    };
    const posts = existing.map((p, i) => (i === idx ? post : p));
    await env.CONTENT_KV.put(CHANGELOG_KV_KEY, JSON.stringify(posts));
    return jsonResponse({ post, posts });
  }

  /* ---- Guide ---- */

  if (method === 'GET' && pathname === '/api/content/guides') {
    return jsonResponse({
      articles: await loadGuides(env),
      storageReady: Boolean(env.CONTENT_KV),
    });
  }

  if (method === 'POST' && pathname === '/api/content/guides') {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const validated = validateGuideInput(await readJsonBody(request));
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const existing = await loadGuides(env);
    if (existing.length >= MAX_CONTENT_ITEMS) {
      return jsonResponse({ error: 'Maximum number of guide articles reached.' }, 400);
    }

    const now = new Date().toISOString();
    const article: GuideArticle = {
      id: `guide-${randomHex(8)}`,
      slug: `${slugifyTitle(validated.data.title)}-${randomHex(3)}`,
      ...validated.data,
      createdAt: now,
      updatedAt: now,
    };
    const articles = [...existing, article];
    await env.CONTENT_KV.put(GUIDE_KV_KEY, JSON.stringify(articles));
    return jsonResponse({ article, articles }, 201);
  }

  const guideMatch = pathname.match(/^\/api\/content\/guides\/([a-zA-Z0-9_-]{1,64})$/);
  if (guideMatch && (method === 'PUT' || method === 'DELETE')) {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const id = guideMatch[1];
    const existing = await loadGuides(env);
    const idx = existing.findIndex((a) => a.id === id);
    if (idx === -1) return jsonResponse({ error: 'Guide article not found.' }, 404);

    if (method === 'DELETE') {
      const articles = existing.filter((a) => a.id !== id);
      await env.CONTENT_KV.put(GUIDE_KV_KEY, JSON.stringify(articles));
      return jsonResponse({ ok: true, articles });
    }

    const validated = validateGuideInput(await readJsonBody(request));
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const article: GuideArticle = {
      ...existing[idx],
      ...validated.data,
      updatedAt: new Date().toISOString(),
    };
    const articles = existing.map((a, i) => (i === idx ? article : a));
    await env.CONTENT_KV.put(GUIDE_KV_KEY, JSON.stringify(articles));
    return jsonResponse({ article, articles });
  }

  return jsonResponse({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const handled = await handleApiRequest(request, env);
    if (handled) return handled;
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  },
};
