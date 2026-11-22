import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActiveLifetimeEntitlement,
  buildDeveloperEntitlement,
  buildRestoredLifetimeEntitlement,
  evaluateTwitchSubscription,
  evaluatePatreonMembership,
  getLifetimeGrantKvKey,
  isDeveloperTwitchLogin,
  mergeLifetimeGrantRecord,
} from './entitlement';

test('Twitch: verifies active Tier 1 / Prime subscription', () => {
  const result = evaluateTwitchSubscription(
    200,
    {
      data: [
        {
          broadcaster_id: '123456',
          broadcaster_name: 'CreatorChannel',
          is_gift: false,
          tier: '1000',
        },
      ],
    },
    '123456'
  );
  assert.equal(result.active, true);
  assert.equal(result.provider, 'twitch');
  assert.equal(result.tierLabel, 'Tier 1 / Prime');
  assert.equal(result.isGift, false);
});

test('Twitch: verifies gifted Tier 2 subscription', () => {
  const result = evaluateTwitchSubscription(
    200,
    {
      data: [
        {
          broadcaster_id: '123456',
          broadcaster_name: 'CreatorChannel',
          is_gift: true,
          tier: '2000',
        },
      ],
    },
    '123456'
  );
  assert.equal(result.active, true);
  assert.equal(result.tierLabel, 'Gifted Tier 2');
  assert.equal(result.isGift, true);
});

test('Twitch: rejects 404 non-subscriber', () => {
  const result = evaluateTwitchSubscription(404, { error: 'Not Found' }, '123456');
  assert.equal(result.active, false);
  assert.equal(result.tierLabel, 'Not Subscribed');
});

test('Twitch: rejects mismatched broadcaster_id', () => {
  const result = evaluateTwitchSubscription(
    200,
    {
      data: [
        {
          broadcaster_id: '999999',
          broadcaster_name: 'OtherChannel',
          is_gift: false,
          tier: '1000',
        },
      ],
    },
    '123456'
  );
  assert.equal(result.active, false);
  assert.equal(result.tierLabel, 'Channel Mismatch');
});

test('Patreon: approves active patron at $5.00 (500 cents)', () => {
  const payload = {
    data: { id: 'u1', attributes: { full_name: 'Alex Patron' } },
    included: [
      {
        id: 'tier_5',
        type: 'tier',
        attributes: { title: 'App Supporter', amount_cents: 500 },
      },
      {
        id: 'mem_1',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 500,
        },
        relationships: {
          campaign: { data: { id: 'camp_1', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: 'tier_5', type: 'tier' }] },
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, {
    minTierCents: 500,
    requiredCampaignId: 'camp_1',
  });
  assert.equal(result.active, true);
  assert.equal(result.amountCents, 500);
  assert.match(result.tierLabel, /App Supporter/);
});

test('Patreon: rejects active patron below $5 tier ($3.00)', () => {
  const payload = {
    data: { id: 'u2' },
    included: [
      {
        id: 'tier_3',
        type: 'tier',
        attributes: { title: 'Coffee Tip', amount_cents: 300 },
      },
      {
        id: 'mem_2',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 300,
        },
        relationships: {
          campaign: { data: { id: 'camp_1', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: 'tier_3', type: 'tier' }] },
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, {
    minTierCents: 500,
    requiredCampaignId: 'camp_1',
  });
  assert.equal(result.active, false);
  assert.match(result.reason, /\$3\.00\/mo/);
});

test('Patreon: rejects former_patron even if previous amount was $5+', () => {
  const payload = {
    data: { id: 'u3' },
    included: [
      {
        id: 'mem_3',
        type: 'member',
        attributes: {
          patron_status: 'former_patron',
          currently_entitled_amount_cents: 500,
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, { minTierCents: 500 });
  assert.equal(result.active, false);
  assert.match(result.reason, /former patron/);
});

test('Patreon: grants lifetime access to former_patron with lifetime_support_cents >= minTierCents', () => {
  const payload = {
    data: { id: 'u3b' },
    included: [
      {
        id: 'mem_3b',
        type: 'member',
        attributes: {
          patron_status: 'former_patron',
          currently_entitled_amount_cents: 0,
          lifetime_support_cents: 500,
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, { minTierCents: 500 });
  assert.equal(result.active, true);
  assert.equal(result.lifetime, true);
  assert.equal(result.tierCode, 'lifetime');
  assert.equal(result.tierLabel, 'Lifetime Access');
});

test('Patreon: enforces requiredTierId when specified', () => {
  const payload = {
    data: { id: 'u4' },
    included: [
      {
        id: 'mem_4',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 1000,
        },
        relationships: {
          currently_entitled_tiers: { data: [{ id: 'other_tier', type: 'tier' }] },
        },
      },
    ],
  };

  const rejected = evaluatePatreonMembership(payload, {
    requiredTierId: 'vip_tier',
  });
  assert.equal(rejected.active, false);
});

test('Developer allowlist: recognizes dopalonee case-insensitively and ignores non-developers', () => {
  assert.equal(isDeveloperTwitchLogin('Dopalonee'), true);
  assert.equal(isDeveloperTwitchLogin(' dopalonee '), true);
  assert.equal(isDeveloperTwitchLogin('other_user'), false);
  assert.equal(isDeveloperTwitchLogin('friend_dev', 'friend_dev,second_dev'), true);
});

test('Developer entitlement: constructs active Developer tier payload', () => {
  const ent = buildDeveloperEntitlement('twitch', 'Developer Twitch account verified.');
  assert.equal(ent.active, true);
  assert.equal(ent.provider, 'twitch');
  assert.equal(ent.tierLabel, 'Developer');
  assert.equal(ent.tierCode, 'developer');
});

test('Lifetime helpers: preserve earliest grantedAt and restore active access cleanly', () => {
  const live = evaluateTwitchSubscription(
    200,
    { data: [{ broadcaster_id: '123', tier: '1000', is_gift: false }] },
    '123',
    '2026-10-01T00:00:00.000Z'
  );
  const user = {
    id: 'twitch:999',
    provider: 'twitch' as const,
    username: 'exile_fan',
    displayName: 'ExileFan',
  };
  assert.equal(getLifetimeGrantKvKey(user.id), 'lifetime:v1:twitch:999');

  const rec1 = mergeLifetimeGrantRecord(null, user, live, '2026-10-01T00:00:00.000Z');
  assert.equal(rec1.grantedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(rec1.sourceTierLabel, 'Tier 1 / Prime');

  const rec2 = mergeLifetimeGrantRecord(
    rec1,
    user,
    { ...live, tierLabel: 'Tier 2' },
    '2026-11-22T00:00:00.000Z'
  );
  assert.equal(rec2.grantedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(rec2.lastVerifiedAt, '2026-11-22T00:00:00.000Z');

  const activeApplied = applyActiveLifetimeEntitlement(live, rec1);
  assert.equal(activeApplied.lifetime, true);
  assert.match(activeApplied.tierLabel, /Lifetime/);

  const restored = buildRestoredLifetimeEntitlement(rec1, '2026-12-01T00:00:00.000Z');
  assert.equal(restored.active, true);
  assert.equal(restored.lifetime, true);
  assert.equal(restored.tierCode, 'lifetime');
  assert.equal(restored.tierLabel, 'Lifetime Access');
  assert.match(restored.reason, /2026-10-01/);
});


