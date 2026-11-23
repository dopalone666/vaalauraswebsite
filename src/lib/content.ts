import type { ChangelogPost, GuideArticle } from '../types';

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  let candidate: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    candidate = segments[0] || null;
  } else if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
    candidate = parsed.searchParams.get('v');
  } else {
    const match = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})(?:\/|$)/);
    if (match) {
      candidate = match[1];
    }
  }

  if (!candidate || !YOUTUBE_ID_REGEX.test(candidate)) {
    return null;
  }
  return candidate;
}

export function normalizeYouTubeUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || !String(rawUrl).trim()) {
    return null;
  }
  const id = extractYouTubeVideoId(String(rawUrl));
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function slugifyTitle(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'guide-article';
}

export function formatDisplayDate(date: Date = new Date()): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface ValidatedChangelogInput {
  version: string;
  category: string;
  publishedAt: string;
  summary: string;
  body: string;
}

export function validateChangelogInput(
  raw: Record<string, unknown> | null
): { ok: true; data: ValidatedChangelogInput } | { ok: false; error: string } {
  const version = typeof raw?.version === 'string' ? raw.version.trim() : '';
  const category = typeof raw?.category === 'string' ? raw.category.trim() : '';
  const publishedAt = typeof raw?.publishedAt === 'string' ? raw.publishedAt.trim() : '';
  const summary = typeof raw?.summary === 'string' ? raw.summary.trim() : '';
  const body = typeof raw?.body === 'string' ? raw.body.trim() : '';

  if (!version || version.length > 40) {
    return { ok: false, error: 'Version is required (max 40 characters).' };
  }
  if (category.length > 40) {
    return { ok: false, error: 'Category must be 40 characters or fewer.' };
  }
  if (publishedAt.length > 60) {
    return { ok: false, error: 'Release date must be 60 characters or fewer.' };
  }
  if (summary.length > 800) {
    return { ok: false, error: 'Summary must be 800 characters or fewer.' };
  }
  if (!body || body.length > 20000) {
    return { ok: false, error: 'Release notes are required (max 20,000 characters).' };
  }

  return {
    ok: true,
    data: {
      version,
      category: category || 'Core',
      publishedAt: publishedAt || formatDisplayDate(),
      summary,
      body,
    },
  };
}

export interface ValidatedGuideInput {
  title: string;
  topic: string;
  summary: string;
  youtubeUrl: string | null;
  body: string;
}

export function validateGuideInput(
  raw: Record<string, unknown> | null
): { ok: true; data: ValidatedGuideInput } | { ok: false; error: string } {
  const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
  const topic = typeof raw?.topic === 'string' ? raw.topic.trim() : '';
  const summary = typeof raw?.summary === 'string' ? raw.summary.trim() : '';
  const rawYoutubeUrl = typeof raw?.youtubeUrl === 'string' ? raw.youtubeUrl.trim() : '';
  const body = typeof raw?.body === 'string' ? raw.body.trim() : '';

  if (!title || title.length > 160) {
    return { ok: false, error: 'Article title is required (max 160 characters).' };
  }
  if (topic.length > 50) {
    return { ok: false, error: 'Topic must be 50 characters or fewer.' };
  }
  if (summary.length > 600) {
    return { ok: false, error: 'Summary must be 600 characters or fewer.' };
  }

  let youtubeUrl: string | null = null;
  if (rawYoutubeUrl) {
    youtubeUrl = normalizeYouTubeUrl(rawYoutubeUrl);
    if (!youtubeUrl) {
      return {
        ok: false,
        error: 'Enter a valid YouTube link (youtube.com/watch?v=..., youtu.be/..., or /shorts/...).',
      };
    }
  }

  if (!body && !youtubeUrl) {
    return { ok: false, error: 'Add article content or a YouTube video link.' };
  }
  if (body.length > 30000) {
    return { ok: false, error: 'Article content must be 30,000 characters or fewer.' };
  }

  return {
    ok: true,
    data: {
      title,
      topic: topic || 'Getting Started',
      summary,
      youtubeUrl,
      body,
    },
  };
}

export const DEFAULT_CHANGELOG_POSTS: ChangelogPost[] = [
  {
    id: 'release-v1-0-0',
    version: 'v1.0.0',
    category: 'Core',
    publishedAt: '22 November 2026',
    summary: 'Initial VaalAuras release.',
    body: [
      '## Core',
      '- Core aura tracking presets and quick layout switching inside the VaalAuras window.',
    ].join('\n'),
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];

export const DEFAULT_GUIDE_ARTICLES: GuideArticle[] = [
  {
    id: 'guide-getting-started',
    slug: 'getting-started-with-vaalauras',
    title: 'Getting Started',
    topic: 'Getting Started',
    summary: 'Download VaalAuras and get it running in under a minute.',
    youtubeUrl: null,
    body: [
      '## Step 1: Download',
      '- Click Download on the home page and run VaalAuras on your PC.',
      '## Step 2: Need help?',
      '- Join the Discord via the Help link in the top navigation bar.',
    ].join('\n'),
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'guide-overlays-setup',
    slug: 'configuring-auras-and-overlays',
    title: 'Configuring Auras & Overlays',
    topic: 'Overlays',
    summary: 'Set up display scaling, active skill groups, and hotkeys inside VaalAuras.',
    youtubeUrl: null,
    body: [
      '## Positioning Your Overlay',
      '- Use preview mode to drag aura bars to match your HUD resolution cleanly.',
      '## Troubleshooting',
      '- If something feels off or an update looks out of sync, join the Discord via the Help link.',
    ].join('\n'),
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];
