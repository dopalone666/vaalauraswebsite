import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTwitchSubscription,
  evaluatePatreonMembership,
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
