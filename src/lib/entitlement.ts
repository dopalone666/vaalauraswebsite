import type { AccessLevel, AuthProvider, EntitlementResult, TierKey } from '../types';

const DEFAULT_DEV_TWITCH_LOGINS = ['dopalonee'];

export const FEATURES_BASIC = ['basic'] as const;
export const FEATURES_TIER2 = ['basic', 'tier2'] as const;
export const FEATURES_PRO = ['basic', 'tier2', 'patreon10'] as const;

export function featuresForAccessLevel(level: AccessLevel): string[] {
  if (level >= 3) return [...FEATURES_PRO];
  if (level === 2) return [...FEATURES_TIER2];
  if (level === 1) return [...FEATURES_BASIC];
  return [];
}

export function isDeveloperTwitchLogin(
  login?: string | null,
  extraLoginsCsv?: string | null
): boolean {
  const normalized = (login || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const allowlist = new Set(DEFAULT_DEV_TWITCH_LOGINS);
  if (extraLoginsCsv) {
    for (const part of extraLoginsCsv.split(',')) {
      const cleaned = part.trim().toLowerCase();
      if (cleaned) {
        allowlist.add(cleaned);
      }
    }
  }
  return allowlist.has(normalized);
}

export function buildDeveloperEntitlement(
  provider: AuthProvider,
  reason: string = 'Developer account verified (permanent access).',
  nowIso: string = new Date().toISOString()
): EntitlementResult {
  return {
    active: true,
    provider,
    tierLabel: 'Developer · All Features (Lifetime)',
    tierCode: 'developer',
    accessLevel: 3,
    tierKey: 'developer',
    billingType: 'lifetime',
    features: [...FEATURES_PRO],
    amountCents: null,
    isGift: false,
    lifetime: true,
    reason,
    checkedAt: nowIso,
  };
}

interface TwitchSubscriptionItem {
  broadcaster_id?: string;
  broadcaster_login?: string;
  broadcaster_name?: string;
  is_gift?: boolean;
  tier?: string;
}

interface TwitchSubscriptionResponse {
  data?: TwitchSubscriptionItem[];
}

export function formatTwitchTier(tier?: string, isGift?: boolean): string {
  const base =
    tier === '3000'
      ? 'Tier 3'
      : tier === '2000'
        ? 'Tier 2'
        : 'Tier 1 / Prime';
  return isGift ? `Gifted ${base}` : base;
}

export function evaluateTwitchSubscription(
  statusCode: number,
  payload: unknown,
  expectedBroadcasterId?: string,
  nowIso: string = new Date().toISOString()
): EntitlementResult {
  if (statusCode === 404) {
    return {
      active: false,
      provider: 'twitch',
      tierLabel: 'Not Subscribed',
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: null,
      isGift: false,
      lifetime: false,
      reason: 'No active Twitch subscription was found. Tier 1 unlocks monthly access; Tier 2+ unlocks lifetime access.',
      checkedAt: nowIso,
    };
  }

  if (statusCode < 200 || statusCode >= 300) {
    return {
      active: false,
      provider: 'twitch',
      tierLabel: 'Verification Error',
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: null,
      isGift: false,
      lifetime: false,
      reason: `Twitch subscription check returned HTTP ${statusCode}.`,
      checkedAt: nowIso,
    };
  }

  const parsed = payload as TwitchSubscriptionResponse | null;
  const sub = parsed?.data?.[0];

  if (!sub) {
    return {
      active: false,
      provider: 'twitch',
      tierLabel: 'Not Subscribed',
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: null,
      isGift: false,
      lifetime: false,
      reason: 'No active Twitch subscription data returned for this account.',
      checkedAt: nowIso,
    };
  }

  if (
    expectedBroadcasterId &&
    sub.broadcaster_id &&
    sub.broadcaster_id !== expectedBroadcasterId
  ) {
    return {
      active: false,
      provider: 'twitch',
      tierLabel: 'Channel Mismatch',
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: null,
      isGift: false,
      lifetime: false,
      reason: 'Subscription belongs to a different Twitch channel.',
      checkedAt: nowIso,
    };
  }

  const tierCode = sub.tier || '1000';
  const isGift = Boolean(sub.is_gift);
  const baseTierLabel = formatTwitchTier(tierCode, isGift);
  const channelLabel = sub.broadcaster_name || sub.broadcaster_login || 'creator channel';
  const isTier2OrHigher = tierCode === '2000' || tierCode === '3000';

  if (isTier2OrHigher) {
    return {
      active: true,
      provider: 'twitch',
      tierLabel: `${baseTierLabel} · Lifetime`,
      tierCode,
      accessLevel: 2,
      tierKey: 't2_lifetime',
      billingType: 'lifetime',
      features: [...FEATURES_TIER2],
      amountCents: null,
      isGift,
      lifetime: true,
      grantedAt: nowIso,
      reason: `Active ${baseTierLabel} Twitch subscription verified for ${channelLabel}. Tier 2+ features unlocked for lifetime.`,
      checkedAt: nowIso,
    };
  }

  return {
    active: true,
    provider: 'twitch',
    tierLabel: `${baseTierLabel} · Monthly`,
    tierCode,
    accessLevel: 1,
    tierKey: 'basic_monthly',
    billingType: 'monthly',
    features: [...FEATURES_BASIC],
    amountCents: null,
    isGift,
    lifetime: false,
    reason: `Active ${baseTierLabel} Twitch subscription verified for ${channelLabel} (monthly access while subscribed).`,
    checkedAt: nowIso,
  };
}

interface PatreonIncludedResource {
  id: string;
  type: string;
  attributes?: {
    patron_status?: string | null;
    currently_entitled_amount_cents?: number | null;
    will_pay_amount_cents?: number | null;
    last_charge_status?: string | null;
    title?: string | null;
    amount_cents?: number | null;
  };
  relationships?: {
    campaign?: {
      data?: { id?: string; type?: string } | null;
    };
    currently_entitled_tiers?: {
      data?: Array<{ id?: string; type?: string }>;
    };
  };
}

interface PatreonIdentityResponse {
  data?: {
    id?: string;
    attributes?: {
      full_name?: string;
      email?: string;
      image_url?: string;
      vanity?: string;
    };
  };
  included?: PatreonIncludedResource[];
}

export interface PatreonCheckOptions {
  /** Legacy/single threshold override when testing custom minimums directly */
  minTierCents?: number;
  /** Minimum cents for monthly basic access (default 300 = $3.00) */
  basicMinCents?: number;
  /** Minimum cents for Lifetime Tier 2/$5 features (default 500 = $5.00) */
  lifetimeT2MinCents?: number;
  /** Minimum cents for Lifetime Pro/$10 extra features (default 1000 = $10.00) */
  lifetimeProMinCents?: number;
  requiredTierId?: string;
  requiredCampaignId?: string;
  nowIso?: string;
}

const REJECTED_CHARGE_STATUSES = new Set(['declined', 'fraud', 'refunded', 'deleted']);

export function evaluatePatreonMembership(
  payload: unknown,
  options: PatreonCheckOptions = {}
): EntitlementResult {
  const basicMinCents =
    typeof options.basicMinCents === 'number' && options.basicMinCents >= 0
      ? options.basicMinCents
      : typeof options.minTierCents === 'number' && options.minTierCents >= 0
        ? options.minTierCents
        : 300;
  const lifetimeT2MinCents =
    typeof options.lifetimeT2MinCents === 'number' && options.lifetimeT2MinCents >= 0
      ? options.lifetimeT2MinCents
      : 500;
  const lifetimeProMinCents =
    typeof options.lifetimeProMinCents === 'number' && options.lifetimeProMinCents >= 0
      ? options.lifetimeProMinCents
      : 1000;

  const requiredTierId = options.requiredTierId?.trim() || '';
  const requiredCampaignId = options.requiredCampaignId?.trim() || '';
  const nowIso = options.nowIso || new Date().toISOString();

  const parsed = payload as PatreonIdentityResponse | null;
  const included = Array.isArray(parsed?.included) ? parsed.included : [];

  const tierMap = new Map<string, { title: string; amountCents: number }>();
  for (const item of included) {
    if (item.type === 'tier' && item.id) {
      tierMap.set(item.id, {
        title: item.attributes?.title || 'Patron Tier',
        amountCents: Number(item.attributes?.amount_cents ?? 0),
      });
    }
  }

  const allMembers = included.filter((item) => item.type === 'member');
  const matchingMembers = requiredCampaignId
    ? allMembers.filter(
        (m) => m.relationships?.campaign?.data?.id === requiredCampaignId
      )
    : allMembers;

  if (matchingMembers.length === 0) {
    return {
      active: false,
      provider: 'patreon',
      tierLabel: 'No Membership',
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: 0,
      isGift: false,
      lifetime: false,
      reason: requiredCampaignId
        ? 'No Patreon membership found for this creator campaign.'
        : 'No Patreon membership found on this account.',
      checkedAt: nowIso,
    };
  }

  let bestQualifying: {
    tierLabel: string;
    tierCode: string | null;
    amountCents: number;
    accessLevel: 1 | 2 | 3;
    tierKey: TierKey;
    lifetime: boolean;
  } | null = null;

  let closestRejected: {
    status: string;
    chargeStatus: string | null;
    amountCents: number;
    tierLabel: string;
  } | null = null;

  for (const member of matchingMembers) {
    const status = member.attributes?.patron_status || 'unknown';
    const rawChargeStatus = (member.attributes?.last_charge_status || '').trim().toLowerCase();
    const chargeBlocked = rawChargeStatus ? REJECTED_CHARGE_STATUSES.has(rawChargeStatus) : false;

    const entitledCents = Number(
      member.attributes?.currently_entitled_amount_cents ?? 0
    );
    const entitledTierRefs =
      member.relationships?.currently_entitled_tiers?.data || [];
    const tierIds = entitledTierRefs
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id));

    const matchedTierDetails = tierIds
      .map((id) => ({ id, info: tierMap.get(id) }))
      .sort((a, b) => (b.info?.amountCents ?? 0) - (a.info?.amountCents ?? 0));

    const primaryTier = matchedTierDetails[0];
    const formattedDollars = `$${(entitledCents / 100).toFixed(2)}`;
    const resolvedTierLabel = primaryTier?.info?.title
      ? `${primaryTier.info.title} (${formattedDollars}/mo)`
      : `${formattedDollars}/mo Tier`;

    const isActivePatron = status === 'active_patron' && !chargeBlocked;
    const meetsTier = requiredTierId
      ? tierIds.includes(requiredTierId)
      : entitledCents >= basicMinCents;

    if (isActivePatron && meetsTier) {
      let accessLevel: 1 | 2 | 3 = 1;
      let tierKey: TierKey = 'basic_monthly';
      let lifetime = false;

      if (entitledCents >= lifetimeProMinCents) {
        accessLevel = 3;
        tierKey = 'pro_lifetime';
        lifetime = true;
      } else if (entitledCents >= lifetimeT2MinCents) {
        accessLevel = 2;
        tierKey = 't2_lifetime';
        lifetime = true;
      }

      if (
        !bestQualifying ||
        accessLevel > bestQualifying.accessLevel ||
        (accessLevel === bestQualifying.accessLevel &&
          entitledCents > bestQualifying.amountCents)
      ) {
        bestQualifying = {
          tierLabel: resolvedTierLabel,
          tierCode: primaryTier?.id || tierKey,
          amountCents: entitledCents,
          accessLevel,
          tierKey,
          lifetime,
        };
      }
    } else if (
      !closestRejected ||
      entitledCents > closestRejected.amountCents
    ) {
      closestRejected = {
        status,
        chargeStatus: member.attributes?.last_charge_status || null,
        amountCents: entitledCents,
        tierLabel: resolvedTierLabel,
      };
    }
  }

  if (bestQualifying) {
    if (bestQualifying.accessLevel === 3) {
      return {
        active: true,
        provider: 'patreon',
        tierLabel: `${bestQualifying.tierLabel} · Pro Lifetime`,
        tierCode: bestQualifying.tierCode,
        accessLevel: 3,
        tierKey: 'pro_lifetime',
        billingType: 'lifetime',
        features: [...FEATURES_PRO],
        amountCents: bestQualifying.amountCents,
        isGift: false,
        lifetime: true,
        grantedAt: nowIso,
        reason: `Active Patreon $10+ membership verified (${bestQualifying.tierLabel}). All extra Pro features unlocked for lifetime.`,
        checkedAt: nowIso,
      };
    }

    if (bestQualifying.accessLevel === 2) {
      return {
        active: true,
        provider: 'patreon',
        tierLabel: `${bestQualifying.tierLabel} · Lifetime`,
        tierCode: bestQualifying.tierCode,
        accessLevel: 2,
        tierKey: 't2_lifetime',
        billingType: 'lifetime',
        features: [...FEATURES_TIER2],
        amountCents: bestQualifying.amountCents,
        isGift: false,
        lifetime: true,
        grantedAt: nowIso,
        reason: `Active Patreon $5+ membership verified (${bestQualifying.tierLabel}). Standard & Tier 2 features unlocked for lifetime.`,
        checkedAt: nowIso,
      };
    }

    return {
      active: true,
      provider: 'patreon',
      tierLabel: `${bestQualifying.tierLabel} · Monthly`,
      tierCode: bestQualifying.tierCode,
      accessLevel: 1,
      tierKey: 'basic_monthly',
      billingType: 'monthly',
      features: [...FEATURES_BASIC],
      amountCents: bestQualifying.amountCents,
      isGift: false,
      lifetime: false,
      reason: `Active Patreon monthly membership verified (${bestQualifying.tierLabel}). Access stays active while your monthly pledge renews.`,
      checkedAt: nowIso,
    };
  }

  const requiredDollars = `$${(basicMinCents / 100).toFixed(2)}`;
  if (
    closestRejected &&
    closestRejected.chargeStatus &&
    REJECTED_CHARGE_STATUSES.has(closestRejected.chargeStatus.trim().toLowerCase())
  ) {
    return {
      active: false,
      provider: 'patreon',
      tierLabel: `Payment ${closestRejected.chargeStatus}`,
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: closestRejected.amountCents,
      isGift: false,
      lifetime: false,
      reason: `Last Patreon charge status is "${closestRejected.chargeStatus}". Resolve your Patreon payment to unlock access.`,
      checkedAt: nowIso,
    };
  }

  if (closestRejected && closestRejected.status !== 'active_patron') {
    const friendlyStatus = closestRejected.status.replace(/_/g, ' ');
    return {
      active: false,
      provider: 'patreon',
      tierLabel: `Inactive (${friendlyStatus})`,
      tierCode: null,
      accessLevel: 0,
      tierKey: 'none',
      billingType: 'none',
      features: [],
      amountCents: closestRejected.amountCents,
      isGift: false,
      lifetime: false,
      reason: `Patreon membership is currently "${friendlyStatus}". Renew a ${requiredDollars}+ monthly tier (or $5+ / $10+ once for lifetime) to access VaalAuras.`,
      checkedAt: nowIso,
    };
  }

  const currentDollars = closestRejected
    ? `$${(closestRejected.amountCents / 100).toFixed(2)}`
    : '$0.00';

  return {
    active: false,
    provider: 'patreon',
    tierLabel: closestRejected?.tierLabel || `${currentDollars}/mo Tier`,
    tierCode: null,
    accessLevel: 0,
    tierKey: 'none',
    billingType: 'none',
    features: [],
    amountCents: closestRejected?.amountCents ?? 0,
    isGift: false,
    lifetime: false,
    reason: `Current Patreon pledge is ${currentDollars}/mo. At least the ${requiredDollars}/mo tier ($3 monthly, $5 lifetime, or $10 Pro lifetime) is required.`,
    checkedAt: nowIso,
  };
}

export interface LifetimeGrantRecord {
  userId: string;
  provider: AuthProvider;
  username: string;
  displayName: string;
  accessLevel: 2 | 3;
  tierKey: 't2_lifetime' | 'pro_lifetime';
  sourceTierLabel: string;
  grantedAt: string;
  lastVerifiedAt: string;
}

export function getLifetimeGrantKvKey(userId: string): string {
  return `lifetime:v1:${userId}`;
}

export function parseLifetimeGrantRecord(
  raw: string | null | undefined,
  expectedUserId: string
): LifetimeGrantRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LifetimeGrantRecord>;
    if (!parsed || typeof parsed !== 'object' || parsed.userId !== expectedUserId) {
      return null;
    }
    const level: 2 | 3 = parsed.accessLevel === 3 ? 3 : 2;
    const tierKey: 't2_lifetime' | 'pro_lifetime' =
      level === 3 || parsed.tierKey === 'pro_lifetime' ? 'pro_lifetime' : 't2_lifetime';
    return {
      userId: parsed.userId,
      provider: (parsed.provider || 'twitch') as AuthProvider,
      username: typeof parsed.username === 'string' ? parsed.username : 'Member',
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'Member',
      accessLevel: level,
      tierKey,
      sourceTierLabel:
        typeof parsed.sourceTierLabel === 'string' && parsed.sourceTierLabel
          ? parsed.sourceTierLabel
          : level === 3
            ? '$10+ Tier'
            : 'Tier 2 / $5+ Tier',
      grantedAt: typeof parsed.grantedAt === 'string' ? parsed.grantedAt : new Date().toISOString(),
      lastVerifiedAt:
        typeof parsed.lastVerifiedAt === 'string'
          ? parsed.lastVerifiedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function mergeLifetimeGrantRecord(
  existing: LifetimeGrantRecord | null,
  user: { id: string; provider: AuthProvider; username: string; displayName: string },
  live: EntitlementResult,
  nowIso: string = live.checkedAt || new Date().toISOString()
): LifetimeGrantRecord {
  const existingLevel = existing ? existing.accessLevel : 0;
  const liveLevel = live.accessLevel >= 3 ? 3 : 2;
  const accessLevel: 2 | 3 = Math.max(existingLevel, liveLevel) >= 3 ? 3 : 2;
  const tierKey: 't2_lifetime' | 'pro_lifetime' =
    accessLevel === 3 ? 'pro_lifetime' : 't2_lifetime';

  const sourceTierLabel =
    existing && existing.accessLevel > liveLevel
      ? existing.sourceTierLabel
      : live.tierLabel;

  return {
    userId: user.id,
    provider: user.provider,
    username: user.username,
    displayName: user.displayName,
    accessLevel,
    tierKey,
    sourceTierLabel,
    grantedAt: existing?.grantedAt || live.grantedAt || nowIso,
    lastVerifiedAt: nowIso,
  };
}

export function applyActiveLifetimeEntitlement(
  live: EntitlementResult,
  existing: LifetimeGrantRecord | null,
  nowIso: string = live.checkedAt || new Date().toISOString()
): EntitlementResult {
  const existingLevel = existing ? existing.accessLevel : 0;
  const effectiveLevel: 2 | 3 = Math.max(existingLevel, live.accessLevel) >= 3 ? 3 : 2;

  // If user already holds Pro ($10) Lifetime in KV while currently on a lower tier (e.g. $5 or $3)
  if (existing && existing.accessLevel > live.accessLevel) {
    return buildRestoredLifetimeEntitlement(existing, nowIso);
  }

  const tierKey: 't2_lifetime' | 'pro_lifetime' =
    effectiveLevel === 3 ? 'pro_lifetime' : 't2_lifetime';
  const grantedAt = existing?.grantedAt || live.grantedAt || nowIso;

  return {
    ...live,
    active: true,
    accessLevel: effectiveLevel,
    tierKey,
    billingType: 'lifetime',
    features: featuresForAccessLevel(effectiveLevel),
    lifetime: true,
    grantedAt,
  };
}

export function buildRestoredLifetimeEntitlement(
  record: LifetimeGrantRecord,
  nowIso: string = new Date().toISOString()
): EntitlementResult {
  const grantedDate = record.grantedAt ? record.grantedAt.slice(0, 10) : '';
  const sinceText = grantedDate ? ` on ${grantedDate}` : '';
  const isPro = record.accessLevel >= 3;
  return {
    active: true,
    provider: record.provider,
    tierLabel: isPro ? 'Pro Lifetime ($10+ Features)' : 'Lifetime Access (Tier 2 / $5+)',
    tierCode: record.tierKey,
    accessLevel: record.accessLevel,
    tierKey: record.tierKey,
    billingType: 'lifetime',
    features: featuresForAccessLevel(record.accessLevel),
    amountCents: null,
    isGift: false,
    lifetime: true,
    grantedAt: record.grantedAt,
    reason: isPro
      ? `Lifetime Pro access unlocked (${record.sourceTierLabel}${sinceText}). All extra $10+ features remain unlocked permanently.`
      : `Lifetime Tier 2 / $5+ access unlocked (${record.sourceTierLabel}${sinceText}). Features remain unlocked permanently even after subscription ends.`,
    checkedAt: nowIso,
  };
}


