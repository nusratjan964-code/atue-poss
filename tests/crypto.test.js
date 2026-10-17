const assert = require('assert');
const { encrypt, decrypt } = require('../src/security/crypto');

function runCryptoTests() {
  console.log('--- Testing Crypto Security Module ---');

  // Test 1: Encryption produces formatted ciphertext
  const secretToken = 'EAAGNO41x1nQBAO5ZCa4...super_secret_oauth_token';
  const encrypted = encrypt(secretToken);
  assert(encrypted, 'Encrypted token should not be empty');
  assert.notStrictEqual(encrypted, secretToken, 'Ciphertext must differ from plaintext');
  assert(encrypted.split(':').length === 3, 'Ciphertext must follow iv:authTag:encrypted format');
  console.log('  [PASS] Encryption produces valid AES-256-GCM triple format');

  // Test 2: Decryption recovers original plaintext
  const decrypted = decrypt(encrypted);
  assert.strictEqual(decrypted, secretToken, 'Decrypted token must exactly match original secret');
  console.log('  [PASS] Decryption successfully recovers exact plaintext');

  // Test 3: Edge cases (empty string, null, unencrypted strings)
  assert.strictEqual(encrypt(''), '', 'Empty string should return empty string');
  assert.strictEqual(decrypt(''), '', 'Empty string should return empty string');
  assert.strictEqual(decrypt('already-plain-token'), 'already-plain-token', 'Non-encrypted token without colons returns as-is');
  console.log('  [PASS] Edge cases handled gracefully');
}

module.exports = runCryptoTests;

if (require.main === module) {
  try {
    runCryptoTests();
    console.log('All crypto tests passed!\n');
  } catch (err) {
    console.error('Crypto test failed:', err);
    process.exit(1);
  }
}
