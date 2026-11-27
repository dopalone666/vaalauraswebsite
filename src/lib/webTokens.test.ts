import test from 'node:test';
import assert from 'node:assert/strict';
import { openPayloadWeb, randomHex, sealPayloadWeb } from './webTokens';

test('webTokens: sealed sessions hide the payload and expire', async () => {
  const secret = randomHex(32);
  const now = 1_700_000_000;
  const payload = { role: 'developer', marker: 'private-session-payload' };
  const sessionToken = await sealPayloadWeb(payload, secret, 'session', 600, now);
  assert.equal(sessionToken.includes(payload.marker), false);

  const opened = await openPayloadWeb<typeof payload>(
    sessionToken,
    secret,
    'session',
    now + 30
  );
  assert.equal(opened.valid, true);
  if (opened.valid) {
    assert.equal(opened.data.role, payload.role);
    assert.equal(opened.data.marker, payload.marker);
  }

  const expired = await openPayloadWeb(sessionToken, secret, 'session', now + 700);
  assert.equal(expired.valid, false);
});
