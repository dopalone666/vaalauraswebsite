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

export interface SiteSettings {
  title: string;
  tags: string[];
  headline: string;
  subline: string;
  buttons: HomeButton[];
  socials: SocialLinks;
  updatedAt: string;
}
