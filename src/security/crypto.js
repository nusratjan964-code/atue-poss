const crypto = require('crypto');
const config = require('../config');

// Derive 32-byte key from APP_SECRET
const ENCRYPTION_KEY = crypto.createHash('sha256').update(config.APP_SECRET).digest();
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a text string using AES-256-GCM.
 * @param {string} text Plaintext
 * @returns {string} Hex encoded encrypted string (iv:authTag:encrypted)
 */
function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[Crypto] Encryption error:', err.message);
    return text;
  }
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param {string} encryptedText Hex encoded string
 * @returns {string} Plaintext
 */
function decrypt(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) return encryptedText;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[Crypto] Decryption error (returning raw):', err.message);
    return encryptedText;
  }
}

module.exports = {
  encrypt,
  decrypt
};
