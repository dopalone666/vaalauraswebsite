import {
  DEFAULT_CHANGELOG_POSTS,
  DEFAULT_GUIDE_ARTICLES,
  slugifyTitle,
  validateChangelogInput,
  validateGuideInput,
} from './src/lib/content';
import { DEFAULT_HOME, DEFAULT_SITE_SETTINGS, validateSiteInput } from './src/lib/site';
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
const MEDIA_KV_PREFIX = 'media:v1:';
const MAX_CONTENT_ITEMS = 100;
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES: Record<string, { ext: string; mediaType: 'video' | 'image' }> = {
  'video/mp4': { ext: 'mp4', mediaType: 'video' },
  'video/webm': { ext: 'webm', mediaType: 'video' },
  'image/png': { ext: 'png', mediaType: 'image' },
  'image/jpeg': { ext: 'jpg', mediaType: 'image' },
  'image/webp': { ext: 'webp', mediaType: 'image' },
};

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
  const storedHome = stored.home || ({} as Partial<SiteSettings['home']>);
  const heroImages = Array.isArray(storedHome.heroImages)
    ? storedHome.heroImages
    : storedHome.heroImageUrl
      ? [storedHome.heroImageUrl]
      : DEFAULT_HOME.heroImages;
  const featureSectionImages = Array.isArray(storedHome.featureSectionImages)
    ? storedHome.featureSectionImages
    : storedHome.featureSectionImageUrl
      ? [storedHome.featureSectionImageUrl]
      : DEFAULT_HOME.featureSectionImages;
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...stored,
    socials: { ...DEFAULT_SITE_SETTINGS.socials, ...(stored.socials || {}) },
    home: {
      ...DEFAULT_HOME,
      ...storedHome,
      heroImages,
      featureSectionImages,
      features: Array.isArray(storedHome.features) ? storedHome.features : DEFAULT_HOME.features,
    },
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

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function matchesMediaSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'video/mp4') {
    return (
      bytes.length >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    );
  }
  if (mime === 'video/webm') {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  }
  if (mime === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function parseByteRange(
  rangeHeader: string | null,
  totalBytes: number
): { start: number; end: number } | 'invalid' | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return 'invalid';
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return 'invalid';
    const start = Math.max(0, totalBytes - suffixLen);
    return { start, end: Math.max(start, totalBytes - 1) };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Math.min(totalBytes - 1, Number(rawEnd)) : totalBytes - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalBytes || start > end) {
    return 'invalid';
  }
  return { start, end };
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

  /* ---- Uploaded Card Media (MP4, WebM, PNG, JPEG, WebP) ---- */

  if (method === 'POST' && pathname === '/api/media') {
    const denied = await requireDeveloper(request, env);
    if (denied) return denied;
    if (!env.CONTENT_KV) return jsonResponse({ error: KV_MISSING_ERROR }, 503);

    const rawMime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const spec = ALLOWED_MEDIA_TYPES[rawMime];
    if (!spec) {
      return jsonResponse(
        { error: 'Unsupported format. Upload an MP4 or WebM video, or a PNG, JPG, or WebP image.' },
        400
      );
    }

    const declaredLength = Number(request.headers.get('content-length') || '0');
    if (declaredLength > MAX_MEDIA_BYTES) {
      return jsonResponse({ error: 'File too large. Keep uploaded videos and images under 15 MB.' }, 413);
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return jsonResponse({ error: 'Could not read uploaded file.' }, 400);
    }

    if (bytes.byteLength === 0) {
      return jsonResponse({ error: 'Uploaded file is empty.' }, 400);
    }
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      return jsonResponse({ error: 'File too large. Keep uploaded videos and images under 15 MB.' }, 413);
    }
    if (!matchesMediaSignature(bytes, rawMime)) {
      return jsonResponse(
        { error: 'File contents do not match the selected format. Try re-exporting as MP4 (H.264) or WebM.' },
        400
      );
    }

    const id = `med-${randomHex(10)}.${spec.ext}`;
    const payload = JSON.stringify({ contentType: rawMime, data: uint8ToBase64(bytes) });
    await env.CONTENT_KV.put(`${MEDIA_KV_PREFIX}${id}`, payload);
    return jsonResponse(
      {
        ok: true,
        url: `/api/media/${id}`,
        mediaType: spec.mediaType,
        contentType: rawMime,
        size: bytes.byteLength,
      },
      201
    );
  }

  const mediaMatch = pathname.match(/^\/api\/media\/(med-[a-f0-9]{16,32}\.(?:mp4|webm|png|jpg|webp))$/);
  if (mediaMatch && (method === 'GET' || method === 'HEAD')) {
    if (!env.CONTENT_KV) return new Response('Not Found', { status: 404 });
    const raw = await env.CONTENT_KV.get(`${MEDIA_KV_PREFIX}${mediaMatch[1]}`);
    if (!raw) return new Response('Not Found', { status: 404 });

    let stored: { contentType?: string; data?: string } | null = null;
    try {
      stored = JSON.parse(raw) as { contentType?: string; data?: string };
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    if (!stored || typeof stored.data !== 'string' || typeof stored.contentType !== 'string' || !ALLOWED_MEDIA_TYPES[stored.contentType]) {
      return new Response('Not Found', { status: 404 });
    }

    const bytes = base64ToUint8(stored.data);
    const total = bytes.byteLength;
    const range = parseByteRange(request.headers.get('range'), total);
    if (range === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    if (range) {
      const slice = bytes.subarray(range.start, range.end + 1);
      return new Response(method === 'HEAD' ? null : (slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer), {
        status: 206,
        headers: {
          'Content-Type': stored.contentType,
          'Content-Length': String(slice.byteLength),
          'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return new Response(method === 'HEAD' ? null : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
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
