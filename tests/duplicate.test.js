const assert = require('assert');
const { getDb, updateDb } = require('../src/database');
const { hasAlreadyBeenPublishedToAccount } = require('../src/services/scheduler');

function runDuplicateTests() {
  console.log('--- Testing Duplicate Publishing Prevention ---');

  const testFileId = 'test_video_file_duplicate_check_123';
  const testAccountId = 'acc_fb_test_duplicate';
  const testPlatform = 'facebook';

  // 1. Initial state: verify clean slate for test video
  updateDb(draft => {
    draft.publishedPosts = (draft.publishedPosts || []).filter(p => p.fileId !== testFileId);
  });

  const beforePublish = hasAlreadyBeenPublishedToAccount(testFileId, testAccountId, testPlatform);
  assert.strictEqual(beforePublish, false, 'Unpublished video must return false');
  console.log('  [PASS] Unpublished video correctly identified as eligible');

  // 2. Simulate video being published to Facebook
  updateDb(draft => {
    draft.publishedPosts.push({
      id: 'pub_test_dup_1',
      fileId: testFileId,
      platform: testPlatform,
      accountId: testAccountId,
      postUrl: 'https://facebook.com/reel/123456789',
      status: 'published',
      verified: true,
      publishedAt: new Date().toISOString()
    });
  });

  // 3. Check duplicate prevention
  const afterPublish = hasAlreadyBeenPublishedToAccount(testFileId, testAccountId, testPlatform);
  assert.strictEqual(afterPublish, true, 'Already published video must return true (blocked from duplicate posting)');
  console.log('  [PASS] Previously published video blocked from duplicate publication');

  // 4. Verify another video is NOT blocked
  const otherVideoId = 'test_video_file_other_456';
  const otherCheck = hasAlreadyBeenPublishedToAccount(otherVideoId, testAccountId, testPlatform);
  assert.strictEqual(otherCheck, false, 'Different video must remain eligible');
  console.log('  [PASS] Other videos remain eligible without false-positive blocking');

  // Cleanup test data
  updateDb(draft => {
    draft.publishedPosts = (draft.publishedPosts || []).filter(p => p.fileId !== testFileId);
  });
}

module.exports = runDuplicateTests;

if (require.main === module) {
  try {
    runDuplicateTests();
    console.log('All duplicate prevention tests passed!\n');
  } catch (err) {
    console.error('Duplicate test failed:', err);
    process.exit(1);
  }
}
