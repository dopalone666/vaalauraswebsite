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
  parseLifetimeGrantRecord,
} from './entitlement';

test('Twitch: Tier 1 / Prime grants Level 1 monthly basic access (not lifetime)', () => {
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
  assert.equal(result.accessLevel, 1);
  assert.equal(result.tierKey, 'basic_monthly');
  assert.equal(result.billingType, 'monthly');
  assert.equal(result.lifetime, false);
  assert.deepEqual(result.features, ['basic']);
  assert.match(result.tierLabel, /Tier 1 \/ Prime/);
  assert.equal(result.isGift, false);
});

test('Twitch: Tier 2 (and gifted Tier 2) grants Level 2 lifetime Tier 2 features', () => {
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
  assert.equal(result.accessLevel, 2);
  assert.equal(result.tierKey, 't2_lifetime');
  assert.equal(result.billingType, 'lifetime');
  assert.equal(result.lifetime, true);
  assert.deepEqual(result.features, ['basic', 'tier2']);
  assert.match(result.tierLabel, /Gifted Tier 2/);
  assert.equal(result.isGift, true);
});

test('Twitch: rejects 404 non-subscriber and mismatched broadcaster_id', () => {
  const notSub = evaluateTwitchSubscription(404, { error: 'Not Found' }, '123456');
  assert.equal(notSub.active, false);
  assert.equal(notSub.accessLevel, 0);
  assert.deepEqual(notSub.features, []);
  assert.equal(notSub.tierLabel, 'Not Subscribed');

  const wrongChannel = evaluateTwitchSubscription(
    200,
    {
      data: [
        {
          broadcaster_id: '999999',
          broadcaster_name: 'OtherChannel',
          is_gift: false,
          tier: '2000',
        },
      ],
    },
    '123456'
  );
  assert.equal(wrongChannel.active, false);
  assert.equal(wrongChannel.accessLevel, 0);
  assert.equal(wrongChannel.tierLabel, 'Channel Mismatch');
});

test('Patreon: $3.00 tier grants Level 1 monthly basic access only', () => {
  const payload = {
    data: { id: 'u_3' },
    included: [
      {
        id: 'tier_3',
        type: 'tier',
        attributes: { title: 'Supporter', amount_cents: 300 },
      },
      {
        id: 'mem_3',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 300,
          last_charge_status: 'Paid',
        },
        relationships: {
          campaign: { data: { id: 'camp_1', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: 'tier_3', type: 'tier' }] },
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, { requiredCampaignId: 'camp_1' });
  assert.equal(result.active, true);
  assert.equal(result.accessLevel, 1);
  assert.equal(result.tierKey, 'basic_monthly');
  assert.equal(result.billingType, 'monthly');
  assert.equal(result.lifetime, false);
  assert.deepEqual(result.features, ['basic']);
  assert.equal(result.amountCents, 300);
});

test('Patreon: $5.00 tier grants Level 2 Lifetime (Tier 2 features)', () => {
  const payload = {
    data: { id: 'u_5', attributes: { full_name: 'Alex Patron' } },
    included: [
      {
        id: 'tier_5',
        type: 'tier',
        attributes: { title: 'App Supporter', amount_cents: 500 },
      },
      {
        id: 'mem_5',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 500,
          last_charge_status: 'Paid',
        },
        relationships: {
          campaign: { data: { id: 'camp_1', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: 'tier_5', type: 'tier' }] },
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, { requiredCampaignId: 'camp_1' });
  assert.equal(result.active, true);
  assert.equal(result.accessLevel, 2);
  assert.equal(result.tierKey, 't2_lifetime');
  assert.equal(result.billingType, 'lifetime');
  assert.equal(result.lifetime, true);
  assert.deepEqual(result.features, ['basic', 'tier2']);
  assert.equal(result.amountCents, 500);
  assert.match(result.tierLabel, /App Supporter/);
});

test('Patreon: $10.00 tier grants Level 3 Pro Lifetime (patreon10 extra features)', () => {
  const payload = {
    data: { id: 'u_10' },
    included: [
      {
        id: 'tier_10',
        type: 'tier',
        attributes: { title: 'Vaal Pro', amount_cents: 1000 },
      },
      {
        id: 'mem_10',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 1000,
          last_charge_status: 'Paid',
        },
        relationships: {
          campaign: { data: { id: 'camp_1', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: 'tier_10', type: 'tier' }] },
        },
      },
    ],
  };

  const result = evaluatePatreonMembership(payload, { requiredCampaignId: 'camp_1' });
  assert.equal(result.active, true);
  assert.equal(result.accessLevel, 3);
  assert.equal(result.tierKey, 'pro_lifetime');
  assert.equal(result.billingType, 'lifetime');
  assert.equal(result.lifetime, true);
  assert.deepEqual(result.features, ['basic', 'tier2', 'patreon10']);
});

test('Patreon: rejects below $3 ($1.00), declined/refunded charges, and former_patron (no lifetime_support_cents bypass)', () => {
  const lowPledge = evaluatePatreonMembership({
    data: { id: 'u_low' },
    included: [
      {
        id: 'mem_low',
        type: 'member',
        attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 100 },
      },
    ],
  });
  assert.equal(lowPledge.active, false);
  assert.equal(lowPledge.accessLevel, 0);

  const declined = evaluatePatreonMembership({
    data: { id: 'u_declined' },
    included: [
      {
        id: 'mem_dec',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 1000,
          last_charge_status: 'Declined',
        },
      },
    ],
  });
  assert.equal(declined.active, false);
  assert.match(declined.reason, /Declined/);

  const refunded = evaluatePatreonMembership({
    data: { id: 'u_refunded' },
    included: [
      {
        id: 'mem_ref',
        type: 'member',
        attributes: {
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 500,
          last_charge_status: 'Refunded',
        },
      },
    ],
  });
  assert.equal(refunded.active, false);

  // Security check: someone who paid $3 twice (lifetime_support_cents = 600) and cancelled MUST NOT get $5 lifetime
  const formerPatron = evaluatePatreonMembership({
    data: { id: 'u_former' },
    included: [
      {
        id: 'mem_former',
        type: 'member',
        attributes: {
          patron_status: 'former_patron',
          currently_entitled_amount_cents: 0,
          lifetime_support_cents: 600,
        },
      },
    ],
  });
  assert.equal(formerPatron.active, false);
  assert.equal(formerPatron.accessLevel, 0);
  assert.match(formerPatron.reason, /former patron/);
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

  const rejected = evaluatePatreonMembership(payload, { requiredTierId: 'vip_tier' });
  assert.equal(rejected.active, false);
});

test('Developer allowlist & entitlement: constructs Level 3 Developer payload', () => {
  assert.equal(isDeveloperTwitchLogin('Dopalonee'), true);
  assert.equal(isDeveloperTwitchLogin(' dopalonee '), true);
  assert.equal(isDeveloperTwitchLogin('other_user'), false);
  assert.equal(isDeveloperTwitchLogin('friend_dev', 'friend_dev,second_dev'), true);

  const ent = buildDeveloperEntitlement('twitch', 'Developer Twitch account verified.');
  assert.equal(ent.active, true);
  assert.equal(ent.provider, 'twitch');
  assert.equal(ent.tierCode, 'developer');
  assert.equal(ent.accessLevel, 3);
  assert.equal(ent.tierKey, 'developer');
  assert.equal(ent.billingType, 'lifetime');
  assert.equal(ent.lifetime, true);
  assert.deepEqual(ent.features, ['basic', 'tier2', 'patreon10']);
});

test('Lifetime KV records: monotonically upgrade Level 2 -> Level 3 and never downgrade Level 3', () => {
  const t2Live = evaluateTwitchSubscription(
    200,
    { data: [{ broadcaster_id: '123', tier: '2000', is_gift: false }] },
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

  const rec2 = mergeLifetimeGrantRecord(null, user, t2Live, '2026-10-01T00:00:00.000Z');
  assert.equal(rec2.accessLevel, 2);
  assert.equal(rec2.tierKey, 't2_lifetime');
  assert.equal(rec2.grantedAt, '2026-10-01T00:00:00.000Z');

  // Later upgrades to Level 3 ($10 Pro)
  const rec3 = mergeLifetimeGrantRecord(
    rec2,
    user,
    { ...t2Live, accessLevel: 3, tierKey: 'pro_lifetime', tierLabel: 'Vaal Pro ($10.00/mo)' },
    '2026-11-01T00:00:00.000Z'
  );
  assert.equal(rec3.accessLevel, 3);
  assert.equal(rec3.tierKey, 'pro_lifetime');
  assert.equal(rec3.grantedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(rec3.sourceTierLabel, 'Vaal Pro ($10.00/mo)');

  // Subsequent Level 2 check NEVER downgrades Level 3 in KV or live response
  const mergedAgain = mergeLifetimeGrantRecord(rec3, user, t2Live, '2026-12-01T00:00:00.000Z');
  assert.equal(mergedAgain.accessLevel, 3);
  assert.equal(mergedAgain.tierKey, 'pro_lifetime');
  assert.equal(mergedAgain.sourceTierLabel, 'Vaal Pro ($10.00/mo)');

  const activeEvenOnT2 = applyActiveLifetimeEntitlement(t2Live, rec3);
  assert.equal(activeEvenOnT2.accessLevel, 3);
  assert.equal(activeEvenOnT2.tierKey, 'pro_lifetime');
  assert.deepEqual(activeEvenOnT2.features, ['basic', 'tier2', 'patreon10']);

  const parsed = parseLifetimeGrantRecord(JSON.stringify(mergedAgain), user.id);
  assert.ok(parsed);
  assert.equal(parsed.accessLevel, 3);

  const restored = buildRestoredLifetimeEntitlement(rec2, '2026-12-01T00:00:00.000Z');
  assert.equal(restored.active, true);
  assert.equal(restored.accessLevel, 2);
  assert.equal(restored.tierKey, 't2_lifetime');
  assert.deepEqual(restored.features, ['basic', 'tier2']);
  assert.match(restored.reason, /2026-10-01/);
});
