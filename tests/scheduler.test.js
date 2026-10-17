const assert = require('assert');
const { getDb, updateDb } = require('../src/database');
const costTracker = require('../src/services/costTracker');
const { 
  getTodayDateString, 
  getPublishedCountToday, 
  processSchedulerTick,
  approveAndPublishJob 
} = require('../src/services/scheduler');

async function runSchedulerTests() {
  console.log('--- Testing Daily Scheduler & Limit Enforcement ---');

  // Test 1: Timezone date format
  const dhakaDate = costTracker.getLocalDateString('Asia/Dhaka');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dhakaDate), 'Asia/Dhaka date must match YYYY-MM-DD format');
  console.log(`  [PASS] Timezone date calculation works accurately: ${dhakaDate}`);

  // Test 2: Daily 3-video limit calculation
  const originalPosts = JSON.parse(JSON.stringify(getDb().publishedPosts || []));
  const originalQueueJobs = JSON.parse(JSON.stringify(getDb().queueJobs || []));
  const originalSettings = JSON.parse(JSON.stringify(getDb().settings || {}));
  const originalFiles = JSON.parse(JSON.stringify(getDb().driveFiles || {}));
  const originalAccounts = JSON.parse(JSON.stringify(getDb().accounts || []));

  try {
    // Set daily limit to 3
    updateDb(draft => {
      draft.settings.dailyLimit = 3;
      draft.settings.timezone = 'Asia/Dhaka';
      draft.publishedPosts = [
        { id: 'p1', fileId: 'vid1', platform: 'facebook', accountId: 'a1', status: 'published', verified: true, publishedAt: `${dhakaDate}T10:00:00.000Z` },
        { id: 'p2', fileId: 'vid2', platform: 'facebook', accountId: 'a1', status: 'published', verified: true, publishedAt: `${dhakaDate}T12:00:00.000Z` },
        { id: 'p3', fileId: 'vid3', platform: 'youtube', accountId: 'a2', status: 'published', verified: true, publishedAt: `${dhakaDate}T14:00:00.000Z` },
        { id: 'p_sim', fileId: 'vid_sim', platform: 'tiktok', accountId: 'a3', status: 'simulated', verified: false, publishedAt: `${dhakaDate}T15:00:00.000Z` }
      ];
    });

    const count = getPublishedCountToday();
    assert.strictEqual(count, 3, 'Should count exactly 3 verified unique videos (excluding simulated)');
    console.log('  [PASS] getPublishedCountToday accurately counts 3 unique verified videos and excludes simulated');

    // Test 3: Quota reached prevents 4th video processing
    const tickResult = await processSchedulerTick();
    assert.strictEqual(tickResult.status, 'quota_reached', 'Scheduler must return quota_reached when daily limit is met');
    assert.strictEqual(tickResult.publishedToday, 3);
    assert.strictEqual(tickResult.dailyLimit, 3);
    console.log('  [PASS] Scheduler strictly enforces max 3 videos/day limit and halts processing');

    // Test 4: Reset quota and test Review Mode behavior
    updateDb(draft => {
      draft.publishedPosts = []; // 0 today
      draft.queueJobs = [];      // 0 queued
      draft.settings.reviewMode = true;
      draft.settings.autoPublishEnabled = false;
      // Isolate test drive file
      draft.driveFiles = {
        'test_sched_vid_1': {
          fileId: 'test_sched_vid_1',
          name: 'viral_cooking_recipe.mp4',
          title: 'স্পেশাল রেসিপি ভিডিও',
          excluded: false,
          status: 'pending'
        }
      };
      // Pre-populate AI analysis for isolated unit test
      if (!draft.aiAnalyses) draft.aiAnalyses = {};
      draft.aiAnalyses['test_sched_vid_1'] = {
        aiGenerated: true,
        model: 'gemini-2.5-flash',
        analysis: {
          summary: 'টেস্ট ভিডিও সারাংশ',
          mainTopic: 'টেস্ট রেসিপি',
          youtube: { title: 'স্পেশাল রেসিপি ভিডিও #Shorts', description: 'বিবরণ', tags: ['#Shorts'] },
          facebook: { caption: 'ফেসবুক রিলস ক্যাপশন', hashtags: ['#Reels'] },
          instagram: { caption: 'ইনস্টাগ্রাম ক্যাপশন', hashtags: ['#reels'] },
          tiktok: { caption: 'টিকটক ক্যাপশন', hashtags: ['#tiktok'] }
        }
      };
      // Isolate test account to Facebook for this unit test
      draft.accounts = [{ id: 'test_fb_acc', platform: 'facebook', connected: true, pageId: '123456789' }];
    });

    const reviewTick = await processSchedulerTick();
    assert.strictEqual(reviewTick.status, 'awaiting_approval', 'In Review Mode, job must pause at awaiting_approval');
    assert(reviewTick.jobId, 'Job must have a valid generated jobId');
    assert(reviewTick.analysis, 'Job must have generated AI analysis');
    console.log('  [PASS] Review Mode pauses job at awaiting_approval with AI-generated captions');

    // Test 5: Manual approval transitions job to published state
    const { getAdapter } = require('../src/adapters');
    const fbAdapter = getAdapter('facebook');
    const origFbPublish = fbAdapter.publishVideo;
    fbAdapter.publishVideo = async () => ({
      success: true,
      platform: 'facebook',
      live: true,
      postId: 'test_fb_reel_123',
      postUrl: 'https://www.facebook.com/reel/test_fb_reel_123',
      message: 'Verified live test post'
    });

    try {
      const approveResult = await approveAndPublishJob(reviewTick.jobId);
      assert(approveResult, 'Approval must return publishing results');
      assert.strictEqual(approveResult.facebook?.success, true, 'Facebook publish should report success');
      
      const db = getDb();
      const completedJob = db.queueJobs.find(j => j.id === reviewTick.jobId);
      assert.strictEqual(completedJob.status, 'done', 'Approved job must finish with status: done');
      console.log('  [PASS] Manual approval successfully publishes job and marks as done');
    } finally {
      fbAdapter.publishVideo = origFbPublish;
    }

  } finally {
    // Restore original state
    updateDb(draft => {
      draft.publishedPosts = originalPosts;
      draft.settings = originalSettings;
      draft.driveFiles = originalFiles;
      draft.accounts = originalAccounts;
      delete draft.aiAnalyses?.['test_sched_vid_1'];
      draft.queueJobs = originalQueueJobs;
    });
  }
}

module.exports = runSchedulerTests;

if (require.main === module) {
  runSchedulerTests()
    .then(() => console.log('All scheduler tests passed!\n'))
    .catch(err => {
      console.error('Scheduler test failed:', err);
      process.exit(1);
    });
}
