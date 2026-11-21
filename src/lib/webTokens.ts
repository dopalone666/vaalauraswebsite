import type { AuthProvider } from '../types';

const RESERVED_SCHEMES = new Set([
  'http',
  'https',
  'javascript',
  'data',
  'vbscript',
  'file',
  'about',
  'blob',
]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function sanitizeProtocolScheme(rawScheme?: string | null): string {
  const cleaned = (rawScheme || '').trim().toLowerCase().replace(/:\/?\/?$/, '');
  if (!/^[a-z][a-z0-9+.-]{1,30}$/.test(cleaned) || RESERVED_SCHEMES.has(cleaned)) {
    return 'vaalauras';
  }
  return cleaned;
}

export function sanitizeLocalhostPort(rawPort?: number | string | null): number {
  const parsed =
    typeof rawPort === 'number' ? rawPort : Number.parseInt(String(rawPort || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
    return 48912;
  }
  return parsed;
}

export function buildAppLaunchUrl(scheme: string, handoffCode: string): string {
  const safeScheme = sanitizeProtocolScheme(scheme);
  return `${safeScheme}://auth?code=${encodeURIComponent(handoffCode)}`;
}

export function buildLocalhostCallbackUrl(
  port: number | string,
  handoffCode: string
): string {
  const safePort = sanitizeLocalhostPort(port);
  return `http://127.0.0.1:${safePort}/callback?code=${encodeURIComponent(handoffCode)}`;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const binary = atob(normalized + '='.repeat(padLength));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function randomHex(byteLength: number = 16): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(
  secret: string,
  usage: 'sign' | 'verify'
): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function derivePurposeAesKey(
  secret: string,
  purpose: string
): Promise<CryptoKey> {
  const material = textEncoder.encode(`${purpose}::${secret}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', material);
  return globalThis.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface LicenseClaims {
  sub: string;
  provider: AuthProvider;
  username: string;
  tier: string;
  entitled: true;
  jti: string;
  iat: number;
  exp: number;
}

export async function signLicenseTokenWeb(
  input: Omit<LicenseClaims, 'iat' | 'exp' | 'jti'> & { jti?: string },
  secret: string,
  ttlSeconds: number = 7 * 24 * 60 * 60,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const header = bytesToBase64Url(
    textEncoder.encode(JSON.stringify({ alg: 'HS256', typ: 'SGL1' }))
  );
  const claims: LicenseClaims = {
    sub: input.sub,
    provider: input.provider,
    username: input.username,
    tier: input.tier,
    entitled: true,
    jti: input.jti || randomHex(12),
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + ttlSeconds,
  };
  const payload = bytesToBase64Url(textEncoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await importHmacKey(secret, 'sign');
  const sigBuf = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sigBuf))}`;
}

export type VerifyLicenseResult =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; error: string };

export async function verifyLicenseTokenWeb(
  token: string,
  secret: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): Promise<VerifyLicenseResult> {
  if (typeof token !== 'string') {
    return { valid: false, error: 'Token must be a string.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed license token structure.' };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return { valid: false, error: 'Empty license token segment.' };
  }

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(textDecoder.decode(base64UrlToBytes(headerPart)));
  } catch {
    return { valid: false, error: 'Invalid license token header.' };
  }

  if (header.alg !== 'HS256' || header.typ !== 'SGL1') {
    return { valid: false, error: 'Unsupported license token algorithm.' };
  }

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64UrlToBytes(signaturePart);
  } catch {
    return { valid: false, error: 'Invalid license token signature encoding.' };
  }

  const key = await importHmacKey(secret, 'verify');
  const verified = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    textEncoder.encode(`${headerPart}.${payloadPart}`)
  );

  if (!verified) {
    return { valid: false, error: 'Invalid license token signature.' };
  }

  let claims: LicenseClaims;
  try {
    claims = JSON.parse(textDecoder.decode(base64UrlToBytes(payloadPart)));
  } catch {
    return { valid: false, error: 'Invalid license token payload.' };
  }

  if (claims.entitled !== true || !claims.sub || !claims.provider) {
    return { valid: false, error: 'License token missing entitlement claims.' };
  }

  if (typeof claims.exp !== 'number' || claims.exp <= nowEpochSeconds) {
    return { valid: false, error: 'License token has expired.' };
  }

  return { valid: true, claims };
}

export type SealedPurpose = 'oauth_state' | 'auth_claim' | 'session' | 'handoff_code';

export interface SealedEnvelopeMeta {
  p: SealedPurpose;
  jti: string;
  iat: number;
  exp: number;
}

export async function sealPayloadWeb<T extends Record<string, unknown>>(
  payload: T,
  secret: string,
  purpose: SealedPurpose,
  ttlSeconds: number,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const key = await derivePurposeAesKey(secret, purpose);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const envelope: T & SealedEnvelopeMeta = {
    ...payload,
    p: purpose,
    jti: randomHex(16),
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + ttlSeconds,
  };

  const plaintext = textEncoder.encode(JSON.stringify(envelope));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: textEncoder.encode(purpose),
    },
    key,
    plaintext
  );

  return `V1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export type OpenSealedResult<T> =
  | { valid: true; data: T & SealedEnvelopeMeta }
  | { valid: false; error: string };

export async function openPayloadWeb<T extends Record<string, unknown>>(
  token: string,
  secret: string,
  expectedPurpose: SealedPurpose,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): Promise<OpenSealedResult<T>> {
  if (typeof token !== 'string') {
    return { valid: false, error: 'Token must be a string.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'V1' || !parts[1] || !parts[2]) {
    return { valid: false, error: 'Malformed token format.' };
  }

  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64UrlToBytes(parts[1]);
    ciphertext = base64UrlToBytes(parts[2]);
  } catch {
    return { valid: false, error: 'Invalid token encoding.' };
  }

  if (iv.length !== 12) {
    return { valid: false, error: 'Invalid token IV length.' };
  }

  try {
    const key = await derivePurposeAesKey(secret, expectedPurpose);
    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: textEncoder.encode(expectedPurpose),
      },
      key,
      ciphertext
    );
    const parsed = JSON.parse(textDecoder.decode(decrypted)) as T & SealedEnvelopeMeta;

    if (parsed.p !== expectedPurpose || typeof parsed.jti !== 'string') {
      return { valid: false, error: 'Token purpose mismatch.' };
    }

    if (typeof parsed.exp !== 'number' || parsed.exp <= nowEpochSeconds) {
      return { valid: false, error: 'Token has expired.' };
    }

    return { valid: true, data: parsed };
  } catch {
    return { valid: false, error: 'Invalid or expired token.' };
  }
}
