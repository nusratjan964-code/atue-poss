const assert = require('assert');
const { getAdapter, adapters } = require('../src/adapters');

function runAdapterTests() {
  console.log('--- Testing Social Media Adapters & Validation ---');

  // Test 1: Adapter Registry
  const yt = getAdapter('youtube');
  const fb = getAdapter('facebook');
  const ig = getAdapter('instagram');
  const tt = getAdapter('tiktok');

  assert(yt, 'YouTube adapter should be registered');
  assert(fb, 'Facebook adapter should be registered');
  assert(ig, 'Instagram adapter should be registered');
  assert(tt, 'TikTok adapter should be registered');
  assert.strictEqual(getAdapter('unknown_platform'), null, 'Unknown platform should return null');
  console.log('  [PASS] Adapter registry correctly resolves all supported platforms');

  // Test 2: YouTube validation rules
  assert.strictEqual(yt.validateMetadata({ title: '' }).valid, false, 'Empty YouTube title should fail');
  assert.strictEqual(yt.validateMetadata({ title: 'A'.repeat(101) }).valid, false, 'YouTube title > 100 chars should fail');
  assert.strictEqual(yt.validateMetadata({ title: 'Great Video Title #Shorts', description: 'desc' }).valid, true, 'Valid YouTube title should pass');
  console.log('  [PASS] YouTube metadata validation rules enforced (<= 100 chars)');

  // Test 3: Facebook validation rules
  assert.strictEqual(fb.validateMetadata({ caption: '' }).valid, false, 'Empty FB caption should fail');
  assert.strictEqual(fb.validateMetadata({ caption: '   ' }).valid, false, 'Whitespace FB caption should fail');
  assert.strictEqual(fb.validateMetadata({ caption: 'Awesome Facebook Reels video' }).valid, true, 'Valid FB caption should pass');
  console.log('  [PASS] Facebook caption validation rules enforced');

  // Test 4: Instagram validation rules
  assert.strictEqual(ig.validateMetadata({ caption: '' }).valid, false, 'Empty IG caption should fail');
  assert.strictEqual(ig.validateMetadata({ caption: 'A'.repeat(2201) }).valid, false, 'IG caption > 2200 chars should fail');
  const tooManyTags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
  assert.strictEqual(ig.validateMetadata({ caption: 'Valid caption', hashtags: tooManyTags }).valid, false, 'IG > 30 hashtags should fail');
  assert.strictEqual(ig.validateMetadata({ caption: 'Valid caption', hashtags: ['#tag1', '#tag2'] }).valid, true, 'Valid IG caption & tags should pass');
  console.log('  [PASS] Instagram caption (<=2200 chars) and hashtags (<=30) rules enforced');

  // Test 5: TikTok validation rules
  assert.strictEqual(tt.validateMetadata({ caption: '' }).valid, false, 'Empty TikTok caption should fail');
  assert.strictEqual(tt.validateMetadata({ caption: 'A'.repeat(2201) }).valid, false, 'TikTok caption > 2200 chars should fail');
  assert.strictEqual(tt.validateMetadata({ caption: 'Trending TikTok reel #fyp' }).valid, true, 'Valid TikTok caption should pass');
  console.log('  [PASS] TikTok caption validation rules enforced');
}

module.exports = runAdapterTests;

if (require.main === module) {
  try {
    runAdapterTests();
    console.log('All adapter tests passed!\n');
  } catch (err) {
    console.error('Adapter test failed:', err);
    process.exit(1);
  }
}
