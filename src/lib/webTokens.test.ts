import test from 'node:test';
import assert from 'node:assert/strict';
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
} from './webTokens';

test('webTokens: sanitizeProtocolScheme & sanitizeLocalhostPort enforce safe bounds', () => {
  assert.equal(sanitizeProtocolScheme('VaalAuras://'), 'vaalauras');
  assert.equal(sanitizeProtocolScheme('javascript'), 'vaalauras');
  assert.equal(sanitizeProtocolScheme('https'), 'vaalauras');
  assert.equal(sanitizeLocalhostPort(48912), 48912);
  assert.equal(sanitizeLocalhostPort('80'), 48912);
  assert.equal(sanitizeLocalhostPort('bad'), 48912);
  assert.equal(buildAppLaunchUrl('VaalAuras', 'code+1'), 'vaalauras://auth?code=code%2B1');
  assert.equal(
    buildLocalhostCallbackUrl(48912, 'code+1'),
    'http://127.0.0.1:48912/callback?code=code%2B1'
  );
});

test('webTokens: signLicenseTokenWeb & verifyLicenseTokenWeb verify and reject tampering/expiry', async () => {
  const secret = randomHex(32);
  const now = 1_700_000_000;

  const token = await signLicenseTokenWeb(
    {
      sub: 'twitch:999',
      provider: 'twitch',
      username: 'exile_supporter',
      tier: 'Tier 1 / Prime',
      entitled: true,
    },
    secret,
    3600,
    now
  );

  const ok = await verifyLicenseTokenWeb(token, secret, now + 60);
  assert.equal(ok.valid, true);
  if (ok.valid) {
    assert.equal(ok.claims.sub, 'twitch:999');
    assert.equal(ok.claims.tier, 'Tier 1 / Prime');
  }

  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}A.${parts[2]}`;
  assert.equal((await verifyLicenseTokenWeb(tampered, secret, now + 60)).valid, false);
  assert.equal((await verifyLicenseTokenWeb(token, randomHex(32), now + 60)).valid, false);
  assert.equal((await verifyLicenseTokenWeb(token, secret, now + 3700)).valid, false);
});

test('webTokens: AES-GCM sealPayloadWeb isolates purposes, hides payload, and rejects replay across purposes', async () => {
  const secret = randomHex(32);
  const now = 1_700_000_000;

  const sessionToken = await sealPayloadWeb(
    {
      userId: 'patreon:42',
      providerAccessToken: 'secret-provider-oauth-token',
    },
    secret,
    'session',
    600,
    now
  );

  // Encrypted token does not expose plaintext access token
  assert.equal(sessionToken.includes('secret-provider-oauth-token'), false);

  const opened = await openPayloadWeb<{ userId: string; providerAccessToken: string }>(
    sessionToken,
    secret,
    'session',
    now + 30
  );
  assert.equal(opened.valid, true);
  if (opened.valid) {
    assert.equal(opened.data.userId, 'patreon:42');
    assert.equal(opened.data.providerAccessToken, 'secret-provider-oauth-token');
  }

  // Wrong purpose cannot decrypt/open
  const crossPurpose = await openPayloadWeb(sessionToken, secret, 'handoff_code', now + 30);
  assert.equal(crossPurpose.valid, false);

  // Expired fails
  const expired = await openPayloadWeb(sessionToken, secret, 'session', now + 700);
  assert.equal(expired.valid, false);
});
