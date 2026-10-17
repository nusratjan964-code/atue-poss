const assert = require('assert');
const crypto = require('../src/security/crypto');
const googleAuth = require('../src/services/googleAuth');
const googleDrive = require('../src/services/googleDrive');
const geminiAi = require('../src/services/geminiAi');
const { getAdapter } = require('../src/adapters');
const { getDb, updateDb } = require('../src/database');

async function runFullIntegrationTests() {
  console.log('--- Testing Full Integrations (Drive, Gemini, YouTube, Meta, TikTok) ---');

  // =========================================================================
  // 1. Google OAuth & Drive API v3 Integration
  // =========================================================================
  const config = require('../src/config');
  let missingClientThrows = false;
  if (!config.GOOGLE_CLIENT_ID) {
    try {
      googleAuth.getAuthUrl();
    } catch (e) {
      missingClientThrows = true;
      assert(e.message.includes('GOOGLE_CLIENT_ID is not configured'), 'Must error when client ID missing');
    }
    assert(missingClientThrows, 'Must throw error when client ID missing');
    console.log('  [PASS] Missing GOOGLE_CLIENT_ID throws clear actionable configuration error');
  }

  // Test URL structure with client ID set
  const origClientId = config.GOOGLE_CLIENT_ID;
  config.GOOGLE_CLIENT_ID = 'test-mock-client-id.apps.googleusercontent.com';
  try {
    const authUrl = googleAuth.getAuthUrl('test_state_123');
    assert(authUrl.includes('accounts.google.com/o/oauth2/v2/auth'), 'Must use official Google OAuth URL');
    assert(authUrl.includes('drive.readonly'), 'Must request drive.readonly scope');
    assert(authUrl.includes('youtube.upload'), 'Must request youtube.upload scope');
    assert(authUrl.includes('access_type=offline'), 'Must request offline access for token refresh');
    console.log('  [PASS] Google OAuth URL generation includes all required scopes & offline access');
  } finally {
    config.GOOGLE_CLIENT_ID = origClientId;
  }

  // Test folder ID extraction from diverse formats
  const id1 = googleDrive.extractFolderId('https://drive.google.com/drive/folders/1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5?usp=sharing');
  const id2 = googleDrive.extractFolderId('1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5');
  const id3 = googleDrive.extractFolderId('https://drive.google.com/file/d/1lAOiwwK6zD9ket0SIy5We1AIXS_0l3oX/view');
  assert.strictEqual(id1, '1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5');
  assert.strictEqual(id2, '1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5');
  assert.strictEqual(id3, '1lAOiwwK6zD9ket0SIy5We1AIXS_0l3oX');
  console.log('  [PASS] Google Drive folder & file ID extraction handles standard URL patterns');

  const driveTest = await googleDrive.testDriveConnection();
  assert(driveTest.status === 'NOT_CONFIGURED' || driveTest.status === 'AWAITING_OAUTH' || driveTest.status === 'VERIFIED');
  console.log(`  [PASS] Google Drive connection test status reporting: ${driveTest.status}`);

  // =========================================================================
  // 2. Gemini Multimodal AI Integration & Transparency
  // =========================================================================
  const geminiTest = await geminiAi.testGeminiConnection();
  assert(geminiTest.status === 'NOT_CONFIGURED' || geminiTest.status === 'VERIFIED' || geminiTest.status === 'FAILED');
  assert(geminiTest.model, 'Must report configured Gemini model');
  console.log(`  [PASS] Gemini API connection health reporting: ${geminiTest.status} (${geminiTest.model})`);

  // Verify that missing key explicitly flags aiGenerated: false and does NOT falsify success
  const missingKeyAnalysis = await geminiAi.analyzeVideoAndGenerateCaptions({
    fileId: 'mock_test_file_no_key',
    fileName: 'sample_cooking_test.mp4',
    forceRegenerate: true
  });
  if (!process.env.GEMINI_API_KEY) {
    assert.strictEqual(missingKeyAnalysis.success, false, 'Must fail when GEMINI_API_KEY is missing');
    assert.strictEqual(missingKeyAnalysis.aiGenerated, false, 'Must never label missing-key caption as aiGenerated');
    assert(missingKeyAnalysis.error.includes('GEMINI_API_KEY'), 'Must provide clear error message about missing key');
    assert(missingKeyAnalysis.manualFallbackDraft, 'Must supply manualFallbackDraft for optional user editing');
    assert.strictEqual(missingKeyAnalysis.manualFallbackDraft.aiGenerated, false);
    console.log('  [PASS] Missing GEMINI_API_KEY explicitly fails without false AI labeling');
  }

  // =========================================================================
  // 3. YouTube Data API v3 Adapter
  // =========================================================================
  const yt = getAdapter('youtube');
  assert.strictEqual(yt.isConfigured({ connected: true, tokenEncrypted: '' }), false, 'Account without token must not be considered configured');
  assert.strictEqual(yt.isConfigured({ connected: false, tokenEncrypted: 'enc_token' }), false, 'Disconnected account must not be considered configured');

  const ytConnTest = await yt.testConnection({ tokenEncrypted: '' });
  assert.strictEqual(ytConnTest.connected, false);
  console.log('  [PASS] YouTube Adapter enforces real token presence and connection check');

  // Verify upload failure handling when token missing
  let ytUploadFailed = false;
  try {
    await yt.publishVideo({
      video: { fileId: 'vid_123', title: 'Test Title' },
      metadata: { youtube: { title: 'Test #Shorts', description: 'Desc' } },
      account: { tokenEncrypted: '' }
    });
  } catch (err) {
    ytUploadFailed = true;
    assert(err.message.includes('token is missing'), 'Error must explicitly state token is missing');
  }
  assert(ytUploadFailed, 'YouTube upload must throw error when access token is missing');
  console.log('  [PASS] YouTube publish throws error instead of fabricating fake video ID or URL');

  // =========================================================================
  // 4. Facebook Reels Adapter
  // =========================================================================
  const fb = getAdapter('facebook');
  assert.strictEqual(fb.cleanPageIdentifier('https://facebook.com/1309863422219233/'), '1309863422219233');
  assert.strictEqual(fb.cleanPageIdentifier('@AIReelsBD'), 'AIReelsBD');

  const fbConnTest = await fb.testConnection({ tokenEncrypted: '' });
  assert.strictEqual(fbConnTest.connected, false);
  assert.strictEqual(fbConnTest.status, 'NOT_CONFIGURED');
  console.log('  [PASS] Facebook Adapter cleans page identifiers and checks token existence');

  // =========================================================================
  // 5. Instagram Reels Adapter
  // =========================================================================
  const ig = getAdapter('instagram');
  const igConnTest = await ig.testConnection({ tokenEncrypted: '', handle: 'some_user' });
  assert.strictEqual(igConnTest.connected, false);
  assert.strictEqual(igConnTest.status, 'NOT_CONFIGURED');

  const igNonNumeric = await ig.testConnection({ token: 'mock_token', handle: 'alpha_name' });
  assert.strictEqual(igNonNumeric.connected, false);
  console.log('  [PASS] Instagram Adapter enforces numeric Instagram User ID requirement');

  // =========================================================================
  // 6. TikTok Content Posting API Adapter
  // =========================================================================
  const tt = getAdapter('tiktok');
  const ttConnTest = await tt.testConnection({ tokenEncrypted: '' });
  assert.strictEqual(ttConnTest.connected, false);
  assert.strictEqual(ttConnTest.status, 'NOT_CONFIGURED');
  console.log('  [PASS] TikTok Adapter enforces official API token requirement');

  // =========================================================================
  // 7. Security & Secret Protection
  // =========================================================================
  const plainToken = 'secret-meta-access-token-1234567890';
  const enc = crypto.encrypt(plainToken);
  assert.notStrictEqual(enc, plainToken, 'Encrypted token must differ from plaintext');
  assert(enc.includes(':'), 'Encrypted token must contain IV and auth tag separators');
  const dec = crypto.decrypt(enc);
  assert.strictEqual(dec, plainToken, 'Decrypted token must recover exact secret');
  console.log('  [PASS] Secret encryption at rest with AES-256-GCM verified');

  console.log('  [PASS] All integration verification checks passed successfully!');
}

module.exports = runFullIntegrationTests;

if (require.main === module) {
  runFullIntegrationTests()
    .then(() => console.log('Full integration tests passed!\n'))
    .catch(err => {
      console.error('Integration test failed:', err);
      process.exit(1);
    });
}
