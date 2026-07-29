/**
 * Simple AES-256-GCM encryption for storing user AI API keys at rest.
 * Key is derived from BETTER_AUTH_SECRET via PBKDF2.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN   = 32;
const IV_LEN    = 12; // 96-bit for GCM
const TAG_LEN   = 16;
const SALT      = 'studyworks-ai-key-salt-v1'; // fixed — key is user-specific

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LEN);
}

export function encryptApiKey(plaintext: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET not set');

  const key = deriveKey(secret);
  const iv  = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(ciphertext: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET not set');

  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted key format');

  const [ivHex, tagHex, dataHex] = parts;
  const key      = deriveKey(secret);
  const iv       = Buffer.from(ivHex, 'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const data     = Buffer.from(dataHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
}
