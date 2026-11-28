#!/usr/bin/env node
/**
 * Sync published GitHub Release metadata from MayuzumiSayaka/cucky into:
 *   1. public/api/releases/latest        — static JSON served by Cloudflare Assets (0 Worker requests)
 *   2. src/generated/releaseIndex.ts     — server-side allowlisted asset ID map bundled into the Worker
 *                                          so downloads skip the extra GitHub release lookup API call.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REPO = (process.env.GITHUB_RELEASES_REPO || 'MayuzumiSayaka/cucky').trim();
const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://vaalauras.com').trim().replace(/\/+$/, '');
const TOKEN = (process.env.GITHUB_RELEASES_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const TARGET_TAG = (process.env.RELEASE_TAG || '').trim();

const RELEASE_TAG_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/;
const ALLOWED_RELEASE_ASSETS = new Set([
  'VaalAurasSetup.exe',
  'VaalAurasSetup-linux-x86_64.sh',
  'vaalauras-update-manifest.json',
  'vaalauras-code-win-x64.tar.gz',
  'vaalauras-code-linux-x64.tar.gz',
  'vaalauras-assets.pak',
]);

if (!TOKEN) {
  console.error('Error: GITHUB_TOKEN or GITHUB_RELEASES_TOKEN environment variable is required.');
  process.exit(1);
}

const ghHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'VaalAuras-ReleaseSync/1.0',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function ghJson(url) {
  const res = await fetch(url, { headers: ghHeaders });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

const releases = await ghJson(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
if (!Array.isArray(releases)) {
  throw new Error('Unexpected GitHub releases response shape.');
}

const published = releases.filter(
  (r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' && RELEASE_TAG_RE.test(r.tag_name.trim())
);
if (published.length === 0) {
  throw new Error(`No published releases found in ${REPO}.`);
}

let latest = null;
if (TARGET_TAG) {
  latest = published.find((r) => r.tag_name.trim() === TARGET_TAG) || null;
}
if (!latest) {
  try {
    const apiLatest = await ghJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (apiLatest && !apiLatest.draft && typeof apiLatest.tag_name === 'string' && RELEASE_TAG_RE.test(apiLatest.tag_name.trim())) {
      latest = apiLatest;
    }
  } catch {
    // Fall back to newest non-draft, non-prerelease release from list.
  }
}
if (!latest) {
  latest = published[0];
}

const latestTag = latest.tag_name.trim();
const latestAssets = (Array.isArray(latest.assets) ? latest.assets : [])
  .filter((a) => typeof a?.name === 'string' && ALLOWED_RELEASE_ASSETS.has(a.name))
  .map((a) => ({
    name: a.name,
    size: Number(a.size || 0),
    digest: typeof a.digest === 'string' ? a.digest : '',
    downloadUrl: `${ORIGIN}/api/releases/download/${encodeURIComponent(latestTag)}/${encodeURIComponent(a.name)}`,
  }));

const latestPayload = {
  ok: true,
  version: latestTag.replace(/^v/i, ''),
  tag: latestTag,
  name: String(latest.name || `VaalAuras ${latestTag}`),
  publishedAt: String(latest.published_at || ''),
  notes: String(latest.body || ''),
  assets: latestAssets,
};

const releaseIndex = {};
for (const rel of published) {
  const tag = rel.tag_name.trim();
  const byName = {};
  for (const asset of Array.isArray(rel.assets) ? rel.assets : []) {
    if (typeof asset?.name !== 'string' || !ALLOWED_RELEASE_ASSETS.has(asset.name)) continue;
    const id = Number(asset.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    byName[asset.name] = {
      id,
      size: Number(asset.size || 0),
      contentType: typeof asset.content_type === 'string' && asset.content_type ? asset.content_type : 'application/octet-stream',
    };
  }
  if (Object.keys(byName).length > 0) {
    releaseIndex[tag] = byName;
  }
}
const manifestName = 'vaalauras-update-manifest.json';
const manifestAsset = latest.assets?.find((asset) => asset.name === manifestName);

if (!Number.isSafeInteger(manifestAsset?.id) || manifestAsset.id <= 0) {
  throw new Error(`Release ${latestTag} is missing ${manifestName}.`);
}

const manifestResponse = await fetch(
  `https://api.github.com/repos/${REPO}/releases/assets/${manifestAsset.id}`,
  {
    headers: { ...ghHeaders, Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(30_000),
  },
);

if (!manifestResponse.ok) {
  throw new Error(`GitHub manifest download failed (${manifestResponse.status}).`);
}

const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.version !== latestPayload.version || !manifest.signature) {
  throw new Error(`Release ${latestTag} has a missing signature or mismatched manifest version.`);
}

const manifestDir = path.join(ROOT, 'public', 'api', 'releases', 'download', latestTag);
await mkdir(manifestDir, { recursive: true });
await writeFile(path.join(manifestDir, manifestName), manifestBytes);
const latestFile = path.join(ROOT, 'public', 'api', 'releases', 'latest');
const indexFile = path.join(ROOT, 'src', 'generated', 'releaseIndex.ts');

await mkdir(path.dirname(latestFile), { recursive: true });
await mkdir(path.dirname(indexFile), { recursive: true });

await writeFile(latestFile, `${JSON.stringify(latestPayload, null, 2)}\n`, 'utf8');

const tsSource = `// Auto-generated by scripts/sync-releases.mjs — do not edit manually.
// Maps published release tags to server-side GitHub asset IDs for the 6 approved release assets.

export interface IndexedReleaseAsset {
  readonly id: number;
  readonly size: number;
  readonly contentType: string;
}

export const PUBLISHED_RELEASE_INDEX: Readonly<Record<string, Readonly<Record<string, IndexedReleaseAsset>>>> = ${JSON.stringify(releaseIndex, null, 2)};
`;

await writeFile(indexFile, tsSource, 'utf8');
console.log(
  `Synced ${latestTag} (${latestAssets.length} approved assets) -> public/api/releases/latest and ${Object.keys(releaseIndex).length} published releases -> src/generated/releaseIndex.ts`
);
