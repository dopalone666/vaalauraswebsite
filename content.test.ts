import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  normalizeYouTubeUrl,
  slugifyTitle,
  validateChangelogInput,
  validateGuideInput,
} from './content';

test('extractYouTubeVideoId parses valid YouTube formats and rejects unsafe URLs', () => {
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.equal(
    extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42'),
    'dQw4w9WgXcQ'
  );
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/shorts/abc123XYZ_9'),
    'abc123XYZ_9'
  );
  assert.equal(
    extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/abc123XYZ_9'),
    'abc123XYZ_9'
  );
  assert.equal(
    extractYouTubeVideoId('https://m.youtube.com/live/abc123XYZ_9'),
    'abc123XYZ_9'
  );

  // Reject unsafe schemes, non-YouTube domains, and malformed video IDs
  assert.equal(extractYouTubeVideoId('javascript:alert(1)'), null);
  assert.equal(extractYouTubeVideoId('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(extractYouTubeVideoId('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(extractYouTubeVideoId('not-a-url'), null);
});

test('normalizeYouTubeUrl normalizes valid links and returns null when empty', () => {
  assert.equal(normalizeYouTubeUrl(''), null);
  assert.equal(normalizeYouTubeUrl(null), null);
  assert.equal(
    normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('slugifyTitle builds clean URL slugs', () => {
  assert.equal(slugifyTitle('  How to Setup VaalAuras!! '), 'how-to-setup-vaalauras');
  assert.equal(slugifyTitle('***'), 'guide-article');
});

test('validateChangelogInput enforces required fields and sets sensible defaults', () => {
  const missing = validateChangelogInput({ version: 'v1.1.0', body: '' });
  assert.equal(missing.ok, false);

  const valid = validateChangelogInput({
    version: ' v1.2.0 ',
    body: '## Fixes\n- Resolved aura sync jitter.',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.version, 'v1.2.0');
    assert.equal(valid.data.category, 'Core');
    assert.ok(valid.data.publishedAt.length > 0);
  }
});

test('validateGuideInput validates YouTube links and requires body or video', () => {
  const empty = validateGuideInput({ title: 'Test Guide', body: '', youtubeUrl: '' });
  assert.equal(empty.ok, false);

  const badYt = validateGuideInput({
    title: 'Test Guide',
    body: 'Some steps',
    youtubeUrl: 'https://vimeo.com/123456',
  });
  assert.equal(badYt.ok, false);

  const videoOnly = validateGuideInput({
    title: 'Overlay Walkthrough',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
  });
  assert.equal(videoOnly.ok, true);
  if (videoOnly.ok) {
    assert.equal(videoOnly.data.topic, 'Getting Started');
    assert.equal(videoOnly.data.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
});
