export type AuthProvider = 'twitch' | 'patreon' | 'developer';

export interface PublicAppConfig {
  appName: string;
  creatorDisplayName: string;
  protocolScheme: string;
  localhostPort: number;
  patreonMinTierCents: number;
  twitchConfigured: boolean;
  patreonConfigured: boolean;
  twitchCallbackUrl: string;
  patreonCallbackUrl: string;
  appBaseUrl: string;
  twitchChannelUrl: string | null;
  patreonCreatorUrl: string | null;
  signingConfigured: boolean;
  developerLoginConfigured: boolean;
}

export interface EntitlementResult {
  active: boolean;
  provider: AuthProvider;
  tierLabel: string;
  tierCode: string | null;
  amountCents: number | null;
  isGift: boolean;
  reason: string;
  checkedAt: string;
}

export interface VerifiedUser {
  id: string;
  provider: AuthProvider;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SessionInfo {
  user: VerifiedUser;
  entitlement: EntitlementResult;
  isDemo: boolean;
}

export interface LicenseHandoffPayload {
  handoffCode: string;
  licenseToken: string;
  appLaunchUri: string;
  localhostCallbackUrl: string;
  expiresAt: string;
  codeExpiresAt: string;
}
