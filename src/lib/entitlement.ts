import type { AuthProvider, EntitlementResult } from '../types';

const DEFAULT_DEV_TWITCH_LOGINS = ['dopalonee'];

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
    tierLabel: 'Developer',
    tierCode: 'developer',
    amountCents: null,
    isGift: false,
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
      amountCents: null,
      isGift: false,
      reason: 'No active Twitch subscription (paid or Prime) was found for this channel.',
      checkedAt: nowIso,
    };
  }

  if (statusCode < 200 || statusCode >= 300) {
    return {
      active: false,
      provider: 'twitch',
      tierLabel: 'Verification Error',
      tierCode: null,
      amountCents: null,
      isGift: false,
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
      amountCents: null,
      isGift: false,
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
      amountCents: null,
      isGift: false,
      reason: 'Subscription belongs to a different Twitch channel.',
      checkedAt: nowIso,
    };
  }

  const tierCode = sub.tier || '1000';
  const isGift = Boolean(sub.is_gift);
  const tierLabel = formatTwitchTier(tierCode, isGift);
  const channelLabel = sub.broadcaster_name || sub.broadcaster_login || 'creator channel';

  return {
    active: true,
    provider: 'twitch',
    tierLabel,
    tierCode,
    amountCents: null,
    isGift,
    reason: `Active ${tierLabel} Twitch subscription verified for ${channelLabel}.`,
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
      lifetime_support_cents?: number | null;
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
  minTierCents?: number;
  requiredTierId?: string;
  requiredCampaignId?: string;
  nowIso?: string;
}

export function evaluatePatreonMembership(
  payload: unknown,
  options: PatreonCheckOptions = {}
): EntitlementResult {
  const minTierCents =
    typeof options.minTierCents === 'number' && options.minTierCents >= 0
      ? options.minTierCents
      : 500;
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
      amountCents: 0,
      isGift: false,
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
  } | null = null;

  let priorPaidLifetime: {
    tierLabel: string;
    amountCents: number;
  } | null = null;

  let closestRejected: {
    status: string;
    amountCents: number;
    tierLabel: string;
  } | null = null;

  for (const member of matchingMembers) {
    const status = member.attributes?.patron_status || 'unknown';
    const entitledCents = Number(
      member.attributes?.currently_entitled_amount_cents ?? 0
    );
    const lifetimeSupportCents =
      typeof member.attributes?.lifetime_support_cents === 'number'
        ? member.attributes.lifetime_support_cents
        : null;
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

    const isActivePatron = status === 'active_patron';
    const meetsTier = requiredTierId
      ? tierIds.includes(requiredTierId)
      : entitledCents >= minTierCents;

    if (isActivePatron && meetsTier) {
      if (!bestQualifying || entitledCents > bestQualifying.amountCents) {
        bestQualifying = {
          tierLabel: resolvedTierLabel,
          tierCode: primaryTier?.id || null,
          amountCents: entitledCents,
        };
      }
    } else if (
      status === 'former_patron' &&
      !requiredTierId &&
      lifetimeSupportCents !== null &&
      lifetimeSupportCents >= minTierCents
    ) {
      const lifetimeDollars = `$${(lifetimeSupportCents / 100).toFixed(2)}`;
      if (!priorPaidLifetime || lifetimeSupportCents > priorPaidLifetime.amountCents) {
        priorPaidLifetime = {
          tierLabel: `Lifetime Access (${lifetimeDollars} prior support)`,
          amountCents: lifetimeSupportCents,
        };
      }
    } else if (
      !closestRejected ||
      entitledCents > closestRejected.amountCents
    ) {
      closestRejected = {
        status,
        amountCents: entitledCents,
        tierLabel: resolvedTierLabel,
      };
    }
  }

  if (bestQualifying) {
    return {
      active: true,
      provider: 'patreon',
      tierLabel: bestQualifying.tierLabel,
      tierCode: bestQualifying.tierCode,
      amountCents: bestQualifying.amountCents,
      isGift: false,
      reason: `Active Patreon membership verified (${bestQualifying.tierLabel}).`,
      checkedAt: nowIso,
    };
  }

  if (priorPaidLifetime) {
    const lifetimeDollars = `$${(priorPaidLifetime.amountCents / 100).toFixed(2)}`;
    return {
      active: true,
      provider: 'patreon',
      tierLabel: 'Lifetime Access',
      tierCode: 'lifetime',
      amountCents: priorPaidLifetime.amountCents,
      isGift: false,
      lifetime: true,
      grantedAt: nowIso,
      reason: `Prior Patreon support verified (${lifetimeDollars} lifetime). Lifetime access unlocked.`,
      checkedAt: nowIso,
    };
  }

  const requiredDollars = `$${(minTierCents / 100).toFixed(2)}`;
  if (closestRejected && closestRejected.status !== 'active_patron') {
    const friendlyStatus = closestRejected.status.replace(/_/g, ' ');
    return {
      active: false,
      provider: 'patreon',
      tierLabel: `Inactive (${friendlyStatus})`,
      tierCode: null,
      amountCents: closestRejected.amountCents,
      isGift: false,
      reason: `Patreon membership is currently "${friendlyStatus}". Subscribe once (${requiredDollars}+ tier) to unlock lifetime access.`,
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
    amountCents: closestRejected?.amountCents ?? 0,
    isGift: false,
    reason: `Current Patreon pledge is ${currentDollars}/mo. Subscribe once at ${requiredDollars}+ to unlock lifetime app access.`,
    checkedAt: nowIso,
  };
}

export interface LifetimeGrantRecord {
  userId: string;
  provider: AuthProvider;
  username: string;
  displayName: string;
  sourceTierLabel: string;
  grantedAt: string;
  lastVerifiedAt: string;
}

export function getLifetimeGrantKvKey(userId: string): string {
  return `lifetime:v1:${userId}`;
}

export function mergeLifetimeGrantRecord(
  existing: LifetimeGrantRecord | null,
  user: { id: string; provider: AuthProvider; username: string; displayName: string },
  live: EntitlementResult,
  nowIso: string = live.checkedAt || new Date().toISOString()
): LifetimeGrantRecord {
  return {
    userId: user.id,
    provider: user.provider,
    username: user.username,
    displayName: user.displayName,
    sourceTierLabel: existing?.sourceTierLabel || live.tierLabel,
    grantedAt: existing?.grantedAt || live.grantedAt || nowIso,
    lastVerifiedAt: nowIso,
  };
}

export function applyActiveLifetimeEntitlement(
  live: EntitlementResult,
  existing: LifetimeGrantRecord | null,
  nowIso: string = live.checkedAt || new Date().toISOString()
): EntitlementResult {
  const grantedAt = existing?.grantedAt || live.grantedAt || nowIso;
  const baseLabel = live.tierCode === 'lifetime' ? 'Lifetime Access' : `${live.tierLabel} · Lifetime`;
  return {
    ...live,
    active: true,
    lifetime: true,
    grantedAt,
    tierLabel: baseLabel,
    reason: `${live.reason} Lifetime access is permanently unlocked for this account.`,
  };
}

export function buildRestoredLifetimeEntitlement(
  record: LifetimeGrantRecord,
  nowIso: string = new Date().toISOString()
): EntitlementResult {
  const grantedDate = record.grantedAt ? record.grantedAt.slice(0, 10) : '';
  const sinceText = grantedDate ? ` on ${grantedDate}` : '';
  return {
    active: true,
    provider: record.provider,
    tierLabel: 'Lifetime Access',
    tierCode: 'lifetime',
    amountCents: null,
    isGift: false,
    lifetime: true,
    grantedAt: record.grantedAt,
    reason: `Lifetime access unlocked (${record.sourceTierLabel}${sinceText}). Active permanently even after subscription ends.`,
    checkedAt: nowIso,
  };
}

