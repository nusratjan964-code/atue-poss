const { getDb, updateDb, addAuditLog } = require('../database');
const costTracker = require('./costTracker');
const geminiAi = require('./geminiAi');
const { getAdapter } = require('../adapters');

let schedulerInterval = null;
let isJobRunning = false;

/**
 * Get date string for today in the user's configured timezone.
 */
function getTodayDateString() {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  return costTracker.getLocalDateString(tz);
}

/**
 * Count how many videos have been successfully published today in the target timezone.
 */
function getPublishedCountToday() {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  const today = costTracker.getLocalDateString(tz);

  if (!db.publishedPosts || !Array.isArray(db.publishedPosts)) return 0;

  // Set of unique fileIds genuinely published today
  const uniqueVideosToday = new Set();
  for (const post of db.publishedPosts) {
    if (!post.publishedAt) continue;
    // Strictly exclude simulated, unverified, or failed posts
    if (post.status === 'simulated' || post.status === 'unverified' || post.status === 'failed' || post.verified === false) {
      continue;
    }
    const publishedDay = costTracker.getLocalDateString(tz, post.publishedAt);
    if (publishedDay === today) {
      uniqueVideosToday.add(post.fileId);
    }
  }

  return uniqueVideosToday.size;
}

/**
 * Check if a specific video has already been published to a specific account.
 */
function hasAlreadyBeenPublishedToAccount(fileId, accountId, platform) {
  const db = getDb();
  if (!db.publishedPosts || !Array.isArray(db.publishedPosts)) return false;

  return db.publishedPosts.some(p => 
    p.fileId === fileId && 
    (p.accountId === accountId || p.platform === platform) &&
    p.verified !== false &&
    p.status !== 'simulated' &&
    p.status !== 'unverified' &&
    p.status !== 'failed'
  );
}

/**
 * Find the next eligible video for processing:
 * 1. Must not be excluded (`f.excluded !== true`)
 * 2. Must not be already published to all active accounts
 * 3. Must not be currently locked by another worker or already awaiting approval
 */
function getNextEligibleVideo() {
  const db = getDb();
  const allFiles = Object.values(db.driveFiles || {});

  // Get active accounts
  const activeAccounts = (db.accounts || []).filter(a => a.connected);
  if (activeAccounts.length === 0) return null;

  for (const file of allFiles) {
    if (file.excluded) continue;

    // Check if locked or already pending/awaiting approval in queue
    const isLocked = (db.queueJobs || []).some(j => 
      j.fileId === file.fileId && 
      (j.status === 'analyzing' || j.status === 'publishing' || j.status === 'awaiting_approval')
    );
    if (isLocked) continue;

    // Check if all connected accounts already published this video
    const allPublished = activeAccounts.every(acc => 
      hasAlreadyBeenPublishedToAccount(file.fileId, acc.id, acc.platform)
    );
    if (allPublished) continue;

    return file;
  }

  return null;
}

/**
 * Count total unique videos processed or awaiting approval today in target timezone.
 */
function getDailyProcessedCountToday() {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  const today = costTracker.getLocalDateString(tz);

  const uniqueVideosToday = new Set();
  if (Array.isArray(db.publishedPosts)) {
    for (const post of db.publishedPosts) {
      if (!post.publishedAt) continue;
      // Strictly exclude simulated, unverified, or failed posts
      if (post.status === 'simulated' || post.status === 'unverified' || post.status === 'failed' || post.verified === false) {
        continue;
      }
      const publishedDay = costTracker.getLocalDateString(tz, post.publishedAt);
      if (publishedDay === today) {
        uniqueVideosToday.add(post.fileId);
      }
    }
  }

  if (Array.isArray(db.queueJobs)) {
    for (const job of db.queueJobs) {
      if (job.status === 'awaiting_approval' || job.status === 'analyzing' || job.status === 'publishing') {
        const jobDay = costTracker.getLocalDateString(tz, job.claimedAt || new Date());
        if (jobDay === today) {
          uniqueVideosToday.add(job.fileId);
        }
      }
    }
  }

  return uniqueVideosToday.size;
}

/**
 * Main worker routine: process up to 1 video per tick, respecting the daily limit.
 */
async function processSchedulerTick() {
  if (isJobRunning) {
    console.log('[Scheduler] Worker tick skipped: previous job is still running (locked).');
    return;
  }

  const db = getDb();
  const dailyLimit = db.settings.dailyLimit || 3;
  const processedToday = getDailyProcessedCountToday();
  const publishedToday = getPublishedCountToday();

  if (processedToday >= dailyLimit) {
    // Daily quota reached
    return {
      status: 'quota_reached',
      publishedToday,
      processedToday,
      dailyLimit,
      message: `আজকের দৈনিক সীমা (${dailyLimit}টি ভিডিও) পূর্ণ হয়েছে। আগামীকাল স্বয়ংক্রিয়ভাবে আবার শুরু হবে।`
    };
  }

  const eligibleVideo = getNextEligibleVideo();
  if (!eligibleVideo) {
    return {
      status: 'no_eligible_videos',
      message: 'প্রসেস করার মতো কোনো নতুন উপযুক্ত ভিডিও পাওয়া যায়নি।'
    };
  }

  isJobRunning = true;
  const jobId = `job_${Date.now()}_${eligibleVideo.fileId.slice(0, 6)}`;

  try {
    console.log(`[Scheduler] Claimed video "${eligibleVideo.title || eligibleVideo.name}" for job ${jobId}`);

    // Lock video and register job in DB immediately
    updateDb(draft => {
      if (!draft.queueJobs) draft.queueJobs = [];
      draft.queueJobs.unshift({
        id: jobId,
        fileId: eligibleVideo.fileId,
        fileName: eligibleVideo.name,
        title: eligibleVideo.title || eligibleVideo.name,
        status: 'analyzing',
        claimedAt: new Date().toISOString(),
        retryCount: 0,
        publishedToday: publishedToday + 1,
        results: {}
      });
    });

    addAuditLog('scheduler', `ভিডিও প্রসেসিং শুরু হয়েছে: "${eligibleVideo.name}" (দৈনিক ক্রমান্বয়ে #${publishedToday + 1})`);

    // Step 1: Gemini AI Content Analysis & Caption Generation
    const aiResult = await geminiAi.analyzeVideoAndGenerateCaptions({
      fileId: eligibleVideo.fileId,
      fileName: eligibleVideo.name,
      durationSec: eligibleVideo.durationSec || 30,
      sizeMb: eligibleVideo.sizeMb || 10,
      language: db.settings.preferredLanguage || 'bn',
      style: db.settings.captionStyle || 'entertaining'
    });

    if (!aiResult.success) {
      updateDb(draft => {
        const job = draft.queueJobs.find(j => j.id === jobId);
        if (job) {
          job.status = 'failed';
          job.error = aiResult.error;
          job.aiAnalysis = aiResult.manualFallbackDraft || null;
          job.aiGenerated = false;
        }
        if (draft.driveFiles?.[eligibleVideo.fileId]) {
          draft.driveFiles[eligibleVideo.fileId].status = 'failed';
        }
      });
      addAuditLog('error', `ভিডিওর AI ক্যাপশন তৈরি ব্যর্থ: "${eligibleVideo.name}" (${aiResult.error})`);
      isJobRunning = false;
      return {
        status: 'failed',
        jobId,
        fileId: eligibleVideo.fileId,
        error: aiResult.error,
        manualFallbackDraft: aiResult.manualFallbackDraft
      };
    }

    // Step 2: Check publishing mode (Review Mode vs Automatic Mode)
    const isAutoPublish = db.settings.autoPublishEnabled && !db.settings.reviewMode;

    if (!isAutoPublish) {
      // In Review Mode: Save as 'awaiting_approval' and stop here
      updateDb(draft => {
        const job = draft.queueJobs.find(j => j.id === jobId);
        if (job) {
          job.status = 'awaiting_approval';
          job.aiAnalysis = aiResult.analysis;
          job.aiGenerated = true;
          job.analyzedAt = new Date().toISOString();
        }
        if (draft.driveFiles?.[eligibleVideo.fileId]) {
          draft.driveFiles[eligibleVideo.fileId].status = 'awaiting_approval';
        }
      });

      addAuditLog('scheduler', `ভিডিওর AI ক্যাপশন তৈরি সম্পন্ন হয়েছে এবং অনুমোদনের অপেক্ষায় (Review Mode): "${eligibleVideo.name}"`);
      isJobRunning = false;
      return {
        status: 'awaiting_approval',
        jobId,
        fileId: eligibleVideo.fileId,
        analysis: aiResult.analysis
      };
    }

    // In Automatic Mode: Execute publishing to all active connected platforms
    await publishJobToPlatforms(jobId);

    isJobRunning = false;
    return { status: 'published', jobId, fileId: eligibleVideo.fileId };
  } catch (err) {
    console.error(`[Scheduler] Job ${jobId} failed:`, err.message);
    updateDb(draft => {
      const job = draft.queueJobs.find(j => j.id === jobId);
      if (job) {
        job.status = 'failed';
        job.error = err.message;
        job.failedAt = new Date().toISOString();
      }
      if (draft.driveFiles?.[eligibleVideo.fileId]) {
        draft.driveFiles[eligibleVideo.fileId].status = 'failed';
      }
    });

    addAuditLog('error', `ভিডিও প্রসেসিং ব্যর্থ: "${eligibleVideo.name}" (${err.message})`);
    isJobRunning = false;
    throw err;
  }
}

/**
 * Publish an approved or auto-publishing job to connected platforms.
 */
async function publishJobToPlatforms(jobId) {
  const db = getDb();
  const job = (db.queueJobs || []).find(j => j.id === jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const file = db.driveFiles?.[job.fileId] || { fileId: job.fileId, title: job.title };
  const aiAnalysis = job.aiAnalysis || db.aiAnalyses?.[job.fileId]?.analysis || {};
  const activeAccounts = (db.accounts || []).filter(a => a.connected);

  updateDb(draft => {
    const j = draft.queueJobs.find(x => x.id === jobId);
    if (j) j.status = 'publishing';
  });

  const publishResults = {};

  for (const account of activeAccounts) {
    // Check duplicate prevention
    if (hasAlreadyBeenPublishedToAccount(file.fileId, account.id, account.platform)) {
      console.log(`[Scheduler] Skipping ${account.platform} for ${file.fileId}: already published previously.`);
      continue;
    }

    const adapter = getAdapter(account.platform);
    if (!adapter) {
      console.warn(`[Scheduler] No adapter found for platform ${account.platform}`);
      continue;
    }

    try {
      const pubResult = await adapter.publishVideo({
        video: file,
        metadata: aiAnalysis,
        account: account,
        options: db.settings.perPlatformSettings?.[account.platform] || {}
      });

      publishResults[account.platform] = pubResult;

      // Record in publishedPosts history to guarantee no duplicate
      updateDb(draft => {
        if (!draft.publishedPosts) draft.publishedPosts = [];
        draft.publishedPosts.push({
          id: `pub_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          fileId: file.fileId,
          platform: account.platform,
          accountId: account.id,
          postUrl: pubResult.postUrl,
          publishedAt: new Date().toISOString(),
          status: pubResult.live ? 'published' : (pubResult.isDraft ? 'draft' : 'processing'),
          verified: !!pubResult.live
        });
      });

      addAuditLog('publish', `পোস্ট সফল (${account.platform.toUpperCase()}): "${file.title}" — <a href="${pubResult.postUrl}" target="_blank">${pubResult.postUrl}</a>`);
    } catch (pubErr) {
      console.error(`[Scheduler] Publishing failed for ${account.platform}:`, pubErr.message);
      publishResults[account.platform] = {
        success: false,
        error: pubErr.message
      };
      addAuditLog('error', `${account.platform.toUpperCase()} পোস্টিং ব্যর্থ: ${pubErr.message}`);
    }
  }

  // Determine overall job outcome
  const resultsList = Object.values(publishResults);
  const anySuccess = resultsList.some(r => r.success);
  const finalJobStatus = anySuccess ? 'done' : 'failed';

  // Update final job status
  updateDb(draft => {
    const j = draft.queueJobs.find(x => x.id === jobId);
    if (j) {
      j.status = finalJobStatus;
      j.results = publishResults;
      j.completedAt = new Date().toISOString();
      if (!anySuccess) {
        j.error = resultsList.map(r => r.error).filter(Boolean).join('; ') || 'All platform publications failed.';
      }
    }
    if (draft.driveFiles?.[file.fileId]) {
      draft.driveFiles[file.fileId].status = finalJobStatus;
    }
  });

  return publishResults;
}

/**
 * Approve a job that was awaiting review and trigger its publication.
 */
async function approveAndPublishJob(jobId, customMetadata = null) {
  const db = getDb();
  const job = (db.queueJobs || []).find(j => j.id === jobId);
  if (!job) throw new Error('Job not found');

  if (customMetadata) {
    updateDb(draft => {
      const j = draft.queueJobs.find(x => x.id === jobId);
      if (j) j.aiAnalysis = customMetadata;
      if (draft.aiAnalyses?.[job.fileId]) {
        draft.aiAnalyses[job.fileId].analysis = customMetadata;
      }
    });
  }

  return await publishJobToPlatforms(jobId);
}

/**
 * Start the background scheduler timer (checks periodically, e.g. every 60 seconds).
 */
function startScheduler(intervalMs = 60000) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log(`[Scheduler] Service started (Polling every ${intervalMs / 1000}s, timezone: Asia/Dhaka, daily limit: 3)`);
  schedulerInterval = setInterval(() => {
    processSchedulerTick().catch(e => console.error('[Scheduler Background Error]:', e.message));
  }, intervalMs);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Service stopped.');
  }
}

module.exports = {
  getTodayDateString,
  getPublishedCountToday,
  getDailyProcessedCountToday,
  hasAlreadyBeenPublishedToAccount,
  getNextEligibleVideo,
  processSchedulerTick,
  publishJobToPlatforms,
  approveAndPublishJob,
  startScheduler,
  stopScheduler
};
