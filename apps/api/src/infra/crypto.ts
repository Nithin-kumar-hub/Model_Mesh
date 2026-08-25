import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'modelmesh.provider.keys.v1';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

const derivedKey = (): Buffer => {
  cachedKey ??= scryptSync(config.security.keyEncryptionSecret, SALT, 32);
  return cachedKey;
};

/** AES-256-GCM. Output: base64(iv):base64(authTag):base64(ciphertext). */
export const encrypt = (plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
};

export const decrypt = (payload: string): string => {
  const [ivPart, tagPart, dataPart] = payload.split(':');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed encrypted payload');

  const decipher = createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** "gsk_abcdef...xyz" → "gsk_****xyz" — safe to log and to show in the app. */
export const maskKey = (key: string): string => {
  if (key.length <= 8) return '****';
  const prefixEnd = key.indexOf('_') > 0 && key.indexOf('_') <= 6 ? key.indexOf('_') + 1 : 3;
  return `${key.slice(0, prefixEnd)}****${key.slice(-3)}`;
};
