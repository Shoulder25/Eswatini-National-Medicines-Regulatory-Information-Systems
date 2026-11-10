const crypto = require('node:crypto');
const { promisify } = require('node:util');
const OTPAuth = require('otpauth');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function decodeKey(value, name) {
  const key = Buffer.from(value || '', 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  return key;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltValue, hashValue] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !saltValue || !hashValue) {
    return false;
  }

  const salt = Buffer.from(saltValue, 'base64');
  const expected = Buffer.from(hashValue, 'base64');
  if (salt.length !== 16 || expected.length !== 64) {
    return false;
  }

  const actual = await scrypt(password, salt, expected.length, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

function encryptTotpSecret(secret, encodedKey) {
  const key = decodeKey(encodedKey, 'AUTH_ENCRYPTION_KEY');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decryptTotpSecret(encryptedValue, encodedKey) {
  const key = decodeKey(encodedKey, 'AUTH_ENCRYPTION_KEY');
  const encrypted = Buffer.from(encryptedValue);
  if (encrypted.length < 29) {
    throw new Error('Invalid encrypted authenticator secret');
  }

  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function getTotpStep(secret, token, window = 1) {
  if (!/^\d{6}$/.test(String(token))) {
    return null;
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'eNMRIS',
    label: 'staff',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: String(token), window });
  return delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
}

function verifyTotpCode(secret, token) {
  return getTotpStep(secret, token) !== null;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function createLoginBucket(email, ipAddress, encodedKey) {
  const key = decodeKey(encodedKey, 'AUTH_RATE_LIMIT_KEY');
  return crypto.createHmac('sha256', key)
    .update(`${String(email).trim().toLowerCase()}\0${ipAddress}`)
    .digest();
}

module.exports = {
  createLoginBucket,
  decodeKey,
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
  hashSessionToken,
  verifyPassword,
  verifyTotpCode,
};
