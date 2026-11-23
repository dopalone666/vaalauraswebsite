import type { HomeButton, HomeButtonStyle, HomeContent, HomeFeature, SiteSettings } from '../types';

export const DEFAULT_SOCIALS = {
  patreon: 'https://www.patreon.com/SayakaNyokota',
  twitch: 'https://www.twitch.tv/icddsayaka',
  discord: 'https://discord.com/invite/GQVy8uUBW',
};

export const DEFAULT_HOME: HomeContent = {
  logoUrl: '/assets/vaalauras_logo.png',
  wordmarkUrl: '/assets/vaalauras_wordmark.png',
  eyebrow: 'THE PATH OF EXILE OVERLAY',
  footnote: 'BUILT FOR YOUR BUILD',
  sectionKicker: 'THE EXPERIENCE',
  sectionTitle: 'Every moment',
  sectionHighlight: 'matters.',
  sectionIntro: 'Your game deserves an interface that stays out of the way until it matters most. Explore VaalAuras and make your overlay your own.',
  features: [
    { eyebrow: 'I / AWARENESS', title: 'See what matters.', description: 'Keep important resources and abilities within sight, without letting the interface take over your screen.', icon: 'eye' },
    { eyebrow: 'II / CONTROL', title: 'Make it yours.', description: 'Shape your setup around the way you play. Your screen, your priorities, your experience.', icon: 'sliders' },
    { eyebrow: 'III / EVOLUTION', title: 'Always improving.', description: 'Follow the changelog as the project evolves, and find walkthroughs when you need a hand.', icon: 'shield' },
  ],
  ctaKicker: 'YOUR NEXT STEP',
  ctaTitle: 'Ready to enter',
  ctaHighlight: 'the fray?',
  ctaDescription: "Get started with the guide, or see what's changed in the latest updates.",
  guideLabel: 'Explore the guide',
  changelogLabel: 'View changelog',
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  title: 'VaalAuras',
  home: DEFAULT_HOME,
  tags: [],
  headline: 'Free, high-performance aura tracking overlay for Path of Exile.',
  subline: 'Built for all builds, with ongoing updates and community feedback.',
  footer: '',
  buttons: [{ id: 'download', label: 'Download', url: '', style: 'primary' }],
  socials: { ...DEFAULT_SOCIALS },
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export const MAX_HOME_BUTTONS = 8;

/** Accepts absolute http(s) URLs or site-relative paths ("/files/app.zip"). Returns normalized string or null. */
export function normalizeLinkUrl(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > 2048) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

export function validateSiteInput(
  raw: Record<string, unknown> | null,
  makeId: () => string
): { ok: true; data: Omit<SiteSettings, 'updatedAt'> } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'Invalid request body.' };

  const title = cleanText(raw.title, 60);
  if (!title) return { ok: false, error: 'Title is required.' };

  const headline = cleanText(raw.headline, 300);
  const subline = cleanText(raw.subline, 300);
  const footer = cleanText(raw.footer, 1000);
  const rawHome = raw.home && typeof raw.home === 'object' && !Array.isArray(raw.home)
    ? raw.home as Record<string, unknown> : {};
  const home = { ...DEFAULT_HOME };
  for (const key of Object.keys(DEFAULT_HOME) as Array<keyof HomeContent>) {
    if (key === 'features' || key === 'logoUrl' || key === 'wordmarkUrl') continue;
    (home as unknown as Record<string, unknown>)[key] = rawHome[key] === undefined ? DEFAULT_HOME[key] : cleanText(rawHome[key], key === 'sectionIntro' || key === 'ctaDescription' ? 800 : 180);
  }
  for (const key of ['logoUrl', 'wordmarkUrl'] as const) {
    const value = typeof rawHome[key] === 'string' ? rawHome[key].trim() : '';
    const normalized = normalizeLinkUrl(value);
    if (value && !normalized) return { ok: false, error: `Invalid ${key} image URL.` };
    home[key] = normalized || DEFAULT_HOME[key];
  }
  const features: HomeFeature[] = [];
  const rawFeatures = Array.isArray(rawHome.features) ? rawHome.features : DEFAULT_HOME.features;
  if (rawFeatures.length > 8) return { ok: false, error: 'Maximum 8 feature cards.' };
  for (const entry of rawFeatures) {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const title = cleanText(item.title, 100);
    if (!title) return { ok: false, error: 'Every feature card requires a title.' };
    features.push({
      title,
      eyebrow: cleanText(item.eyebrow, 60),
      description: cleanText(item.description, 800),
      icon: item.icon === 'sliders' || item.icon === 'shield' ? item.icon : 'eye',
    });
  }
  home.features = features;

  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => cleanText(t, 40))
    .filter(Boolean)
    .slice(0, 6);

  const rawButtons = Array.isArray(raw.buttons) ? raw.buttons : [];
  if (rawButtons.length > MAX_HOME_BUTTONS) {
    return { ok: false, error: `You can add up to ${MAX_HOME_BUTTONS} buttons.` };
  }

  const buttons: HomeButton[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawButtons.length; i += 1) {
    const b = (rawButtons[i] || {}) as Record<string, unknown>;
    const label = cleanText(b.label, 40);
    if (!label) return { ok: false, error: `Button ${i + 1} needs a label.` };

    const urlRaw = typeof b.url === 'string' ? b.url.trim() : '';
    let url = '';
    if (urlRaw) {
      const normalized = normalizeLinkUrl(urlRaw);
      if (!normalized) {
        return { ok: false, error: `Button "${label}" has an invalid link (use https://...).` };
      }
      url = normalized;
    }

    let id = cleanText(b.id, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seen.has(id)) id = makeId();
    seen.add(id);

    const style: HomeButtonStyle = b.style === 'secondary' ? 'secondary' : 'primary';
    buttons.push({ id, label, url, style });
  }

  const socialsRaw = (raw.socials || {}) as Record<string, unknown>;
  const socials = { ...DEFAULT_SOCIALS };
  for (const key of ['patreon', 'twitch', 'discord'] as const) {
    const value = socialsRaw[key];
    if (typeof value === 'string' && value.trim()) {
      const normalized = normalizeLinkUrl(value);
      if (!normalized || normalized.startsWith('/')) {
        return { ok: false, error: `Invalid ${key} link (use a full https:// URL).` };
      }
      socials[key] = normalized;
    }
  }

  return { ok: true, data: { title, home, tags, headline, subline, footer, buttons, socials } };
}
