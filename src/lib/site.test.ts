import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLinkUrl, validateSiteInput } from './site';

const id = () => 'gen1';

test('normalizeLinkUrl allows http(s) and site-relative paths only', () => {
  assert.equal(normalizeLinkUrl('https://example.com/a.zip'), 'https://example.com/a.zip');
  assert.equal(normalizeLinkUrl('/files/app.zip'), '/files/app.zip');
  assert.equal(normalizeLinkUrl('javascript:alert(1)'), null);
  assert.equal(normalizeLinkUrl('//evil.com'), null);
  assert.equal(normalizeLinkUrl('data:text/html,x'), null);
  assert.equal(normalizeLinkUrl(''), null);
});

test('validateSiteInput accepts buttons, keeps order, rejects bad links', () => {
  const ok = validateSiteInput(
    {
      title: ' VaalAuras ',
      tags: ['A', '', 'B'],
      headline: 'h',
      subline: 's',
      footer: 'This is our footer',
      buttons: [
        { id: 'download', label: 'Download', url: 'https://example.com/x.zip', style: 'primary' },
        { label: 'Docs', url: '', style: 'secondary' },
      ],
      socials: { discord: 'https://discord.com/invite/abc' },
    },
    id
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data.title, 'VaalAuras');
    assert.equal(ok.data.footer, 'This is our footer');
    assert.deepEqual(ok.data.tags, ['A', 'B']);
    assert.equal(ok.data.buttons.length, 2);
    assert.equal(ok.data.buttons[1].id, 'gen1');
    assert.equal(ok.data.buttons[1].style, 'secondary');
    assert.equal(ok.data.socials.discord, 'https://discord.com/invite/abc');
    assert.equal(ok.data.socials.patreon, 'https://www.patreon.com/SayakaNyokota');
  }

  const bad = validateSiteInput(
    { title: 'x', buttons: [{ label: 'Go', url: 'javascript:alert(1)' }] },
    id
  );
  assert.equal(bad.ok, false);

  const noLabel = validateSiteInput({ title: 'x', buttons: [{ label: '', url: '' }] }, id);
  assert.equal(noLabel.ok, false);
});


test('platform download links are optional and validated as URLs', () => {
  const existing = validateSiteInput({ title: 'VaalAuras' }, id);
  assert.equal(existing.ok, true);
  if (existing.ok) {
    assert.equal(existing.data.home.windowsDownloadUrl, '');
    assert.equal(existing.data.home.linuxDownloadUrl, '');
  }

  const longUrl = `https://example.com/download?token=${'a'.repeat(250)}`;
  const configured = validateSiteInput({ title: 'VaalAuras', home: { windowsDownloadUrl: ` ${longUrl} ` } }, id);
  assert.equal(configured.ok, true);
  if (configured.ok) assert.equal(configured.data.home.windowsDownloadUrl, longUrl);

  for (const field of ['windowsDownloadUrl', 'linuxDownloadUrl']) {
    assert.equal(validateSiteInput({ title: 'VaalAuras', home: { [field]: 'javascript:alert(1)' } }, id).ok, false);
  }
});

test('footer is plain text, optional, and length-limited', () => {
  const empty = validateSiteInput({ title: 'VaalAuras' }, id);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.data.footer, '');
  const limited = validateSiteInput({ title: 'VaalAuras', footer: 'a'.repeat(1200) }, id);
  assert.equal(limited.ok, true);
  if (limited.ok) assert.equal(limited.data.footer.length, 1000);
});

test('home sections, feature order and image links are validated', () => {
  const saved = validateSiteInput({ title: 'VaalAuras', home: { eyebrow: 'CUSTOM', features: [
    { title: 'One', eyebrow: 'FIRST', description: 'Description', icon: 'shield' },
    { title: 'Two', icon: 'sliders' }
  ], logoUrl: '/assets/logo.png', wordmarkUrl: 'https://example.com/wordmark.png' } }, id);
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.data.home.eyebrow, 'CUSTOM');
    assert.deepEqual(saved.data.home.features.map(f => f.title), ['One', 'Two']);
    assert.equal(saved.data.home.wordmarkUrl, 'https://example.com/wordmark.png');
  }
  const bad = validateSiteInput({ title: 'VaalAuras', home: { logoUrl: 'javascript:alert(1)' } }, id);
  assert.equal(bad.ok, false);
  const tooMany = validateSiteInput({ title: 'VaalAuras', home: { features: Array(9).fill({ title: 'Card' }) } }, id);
  assert.equal(tooMany.ok, false);

  const multi = validateSiteInput(
    {
      title: 'VaalAuras',
      home: {
        heroImages: ['https://example.com/1.png', '/assets/2.png'],
        featureSectionImageUrl: 'https://example.com/legacy.png',
        features: [
          { title: 'Video Card', imageUrl: '/api/media/med-0123456789abcdef0123.mp4', mediaType: 'video', icon: 'eye' },
        ],
      },
    },
    id
  );
  assert.equal(multi.ok, true);
  if (multi.ok) {
    assert.deepEqual(multi.data.home.heroImages, ['https://example.com/1.png', '/assets/2.png']);
    assert.equal(multi.data.home.heroImageUrl, 'https://example.com/1.png');
    assert.deepEqual(multi.data.home.featureSectionImages, ['https://example.com/legacy.png']);
    assert.equal(multi.data.home.featureSectionImageUrl, 'https://example.com/legacy.png');
    assert.equal(multi.data.home.features[0].imageUrl, '/api/media/med-0123456789abcdef0123.mp4');
    assert.equal(multi.data.home.features[0].mediaType, 'video');
  }
});
