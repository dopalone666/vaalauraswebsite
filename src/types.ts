export interface ChangelogPost {
  id: string;
  version: string;
  category: string;
  publishedAt: string;
  summary: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuideArticle {
  id: string;
  slug: string;
  title: string;
  topic: string;
  summary: string;
  youtubeUrl: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type HomeButtonStyle = 'primary' | 'secondary';

export interface HomeButton {
  id: string;
  label: string;
  url: string;
  style: HomeButtonStyle;
}

export interface SocialLinks {
  patreon: string;
  twitch: string;
  discord: string;
}

export interface HomeFeature {
  eyebrow: string;
  imageUrl: string;
  title: string;
  description: string;
  icon: 'eye' | 'sliders' | 'shield' | 'none' | 'custom';
  iconUrl: string;
}

export interface HomeContent {
  logoUrl: string;
  wordmarkUrl: string;
  eyebrow: string;
  footnote: string;
  heroImageUrl: string;
  heroImages: string[];
  featureSectionImageUrl: string;
  featureSectionImages: string[];
  sectionKicker: string;
  sectionTitle: string;
  sectionHighlight: string;
  sectionIntro: string;
  features: HomeFeature[];
  ctaKicker: string;
  ctaTitle: string;
  ctaHighlight: string;
  ctaDescription: string;
  guideLabel: string;
  changelogLabel: string;
}

export interface SiteSettings {
  title: string;
  home: HomeContent;
  tags: string[];
  headline: string;
  subline: string;
  footer: string;
  buttons: HomeButton[];
  socials: SocialLinks;
  updatedAt: string;
}
