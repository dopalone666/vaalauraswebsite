const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

export async function constantTimeEqualStringWeb(
  a: string,
  b: string
): Promise<boolean> {
  const randomKeyBytes = new Uint8Array(new ArrayBuffer(32));
  globalThis.crypto.getRandomValues(randomKeyBytes);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    randomKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const macA = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(a)
  );
  return globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    macA,
    textEncoder.encode(b)
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

export type SealedPurpose = 'session';

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
