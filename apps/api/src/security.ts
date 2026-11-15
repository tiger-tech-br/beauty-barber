import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24).toString('hex');
  const buffer = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${buffer.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex || expectedHex.length !== KEY_LENGTH * 2) return false;
  if (!/^[a-f0-9]+$/.test(expectedHex) || !/^[a-f0-9]+$/.test(salt)) return false;
  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function sessionTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function newSlug(name: string, suffix: string) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
  return `${normalized || 'estudio'}-${suffix}`;
}

