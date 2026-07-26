import crypto from 'crypto';

const ALGO   = 'aes-256-gcm' as const;
const IV_LEN = 12;

function key(): Buffer {
  const k = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!k || k.length !== 64) {
    throw new Error('PAYMENT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32');
  }
  return Buffer.from(k, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv      = crypto.randomBytes(IV_LEN);
  const cipher  = crypto.createCipheriv(ALGO, key(), iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, encHex, tagHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}
