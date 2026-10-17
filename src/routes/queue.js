const express = require('express');
const router = express.Router();
const scheduler = require('../services/scheduler');
const { getDb, updateDb, addAuditLog } = require('../database');
const googleDrive = require('../services/googleDrive');
const geminiAi = require('../services/geminiAi');
const { getAdapter } = require('../adapters');

// List queue jobs
router.get('/', (req, res) => {
  const db = getDb();
  const jobs = db.queueJobs || [];
  const publishedToday = scheduler.getPublishedCountToday();
  const dailyLimit = db.settings.dailyLimit || 3;

  res.json({
    success: true,
    publishedToday,
    dailyLimit,
    remainingToday: Math.max(0, dailyLimit - publishedToday),
    jobs
  });
});

// Trigger a scheduler tick manually
router.post('/trigger-tick', async (req, res) => {
  try {
    const result = await scheduler.processSchedulerTick();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.post('/tick', async (req, res) => {
  try {
    const result = await scheduler.processSchedulerTick();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve and publish a job (Review Mode approval)
router.post('/approve/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { customMetadata } = req.body;

  try {
    const result = await scheduler.approveAndPublishJob(jobId, customMetadata);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Retry a failed job
router.post('/retry/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const db = getDb();
  const job = (db.queueJobs || []).find(j => j.id === jobId);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  updateDb(draft => {
    const j = draft.queueJobs.find(x => x.id === jobId);
    if (j) {
      j.status = 'analyzing';
      j.retryCount = (j.retryCount || 0) + 1;
      delete j.error;
    }
  });

  try {
    const result = await scheduler.publishJobToPlatforms(jobId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete / Cancel a job
router.delete('/:jobId', (req, res) => {
  const { jobId } = req.params;
  updateDb(draft => {
    draft.queueJobs = (draft.queueJobs || []).filter(j => j.id !== jobId);
  });
  addAuditLog('scheduler', `কিউ জব বাতিল করা হয়েছে: "${jobId}"`);
  res.json({ success: true, message: 'Job removed.' });
});

// Instant Test Video Fetch, AI Caption & Multi-Platform Upload
router.post('/instant-publish', async (req, res) => {
  try {
    const { driveUrl, customTitle, platforms } = req.body;
    if (!driveUrl || !driveUrl.trim()) {
      return res.status(400).json({ success: false, error: 'Google Drive ভিডিও বা ফোল্ডার লিংক দেওয়া আবশ্যক।' });
    }

    const rawUrl = driveUrl.trim();
    const fileOrFolderId = googleDrive.extractFolderId(rawUrl);
    if (!fileOrFolderId) {
      return res.status(400).json({ success: false, error: 'সঠিক Google Drive ফাইল আইডি বা লিংক সনাক্ত করা যায়নি।' });
    }

    const db = getDb();
    let targetFile = null;

    // Check if the provided link is a Folder link
    const isFolderUrl = rawUrl.includes('/folders/') || rawUrl.includes('embeddedfolderview');

    if (isFolderUrl) {
      console.log(`[InstantPublish] Drive folder detected: ${fileOrFolderId}. Fetching folder contents...`);
      let folderRes = null;
      try {
        folderRes = await googleDrive.getDriveVideos(fileOrFolderId);
      } catch (fErr) {
        console.error('[InstantPublish] Error loading folder videos:', fErr.message);
      }

      if (!folderRes || !folderRes.files || folderRes.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'ড্রাইভ ফোল্ডারে কোনো ভিডিও পাওয়া যায়নি। অনুগ্রহ করে ফোল্ডারটির শেয়ার পারমিশনে "Anyone with the link" ভিউয়ার অনুমতি দেওয়া আছে কি না নিশ্চিত করুন।'
        });
      }

      // Sync folder files to database
      updateDb(draft => {
        if (!draft.driveFiles) draft.driveFiles = {};
        for (const f of folderRes.files) {
          if (!draft.driveFiles[f.fileId]) {
            draft.driveFiles[f.fileId] = f;
          }
        }
        draft.settings.selectedFolderId = fileOrFolderId;
        if (folderRes.folderTitle) {
          draft.settings.selectedFolderName = folderRes.folderTitle;
        }
      });

      // Pick first unposted video or first video in folder
      const unposted = folderRes.files.find(f => f.status !== 'published') || folderRes.files[0];
      targetFile = { ...unposted };
      if (customTitle) {
        targetFile.title = customTitle;
      }
    } else {
      // Direct File Link
      targetFile = db.driveFiles?.[fileOrFolderId];
      if (!targetFile) {
        const found = Object.values(db.driveFiles || {}).find(f => f.fileId === fileOrFolderId);
        if (found) {
          targetFile = found;
        } else {
          targetFile = {
            fileId: fileOrFolderId,
            name: customTitle ? `${customTitle}.mp4` : `drive_test_video_${Date.now()}.mp4`,
            title: customTitle || 'বাংলা AI ভাইরাল রিলস',
            status: 'ready'
          };
          updateDb(draft => {
            if (!draft.driveFiles) draft.driveFiles = {};
            draft.driveFiles[fileOrFolderId] = targetFile;
          });
        }
      }
      if (customTitle) {
        targetFile.title = customTitle;
      }
    }

    // Generate AI Analysis & Captions
    let aiMetadata = null;
    try {
      const aiRes = await geminiAi.analyzeVideoAndGenerateCaptions({
        fileId: targetFile.fileId,
        fileName: targetFile.name,
        language: db.settings.preferredLanguage || 'bn',
        style: db.settings.captionStyle || 'entertaining'
      });
      if (aiRes.success && aiRes.analysis) {
        aiMetadata = aiRes.analysis;
      }
    } catch (e) {
      console.warn('[InstantPublish] AI analysis error, using fallback:', e.message);
    }

    // Fallback captions if Gemini is not configured or failed
    if (!aiMetadata) {
      const defaultTitle = customTitle || targetFile.title || 'বাংলা AI ভাইরাল রিলস';
      aiMetadata = {
        youtube: {
          title: `${defaultTitle} #Shorts #Trending`,
          description: `${defaultTitle}\n\nভিডিওটি ভালো লাগলে লাইক ও সাবস্ক্রাইব করুন!\n\n#Shorts #BanglaAI #Trending #ViralReels`,
          tags: ['Shorts', 'BanglaAI', 'Viral', 'Trending']
        },
        facebook: {
          caption: `${defaultTitle}\n\nভিডিওটি ভালো লাগলে শেয়ার করুন ও পেজটি ফলো দিয়ে সাথে থাকুন! ❤️\n\n#Reels #Viral #Trending #Bangla`,
          hashtags: ['#Reels', '#Viral', '#Bangla']
        }
      };
    }

    // Filter accounts to publish to
    const targetPlatforms = Array.isArray(platforms) && platforms.length > 0 
      ? platforms.map(p => p.toLowerCase()) 
      : ['youtube', 'facebook'];

    const accountsToPublish = (db.accounts || []).filter(a => 
      a.connected && targetPlatforms.includes(a.platform)
    );

    if (accountsToPublish.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'কোনো সক্রিয় Social Account পাওয়া যায়নি। অনুগ্রহ করে YouTube বা Facebook কানেক্ট নিশ্চিত করুন।'
      });
    }

    const results = {};
    const errors = {};

    for (const acc of accountsToPublish) {
      const adapter = getAdapter(acc.platform);
      if (!adapter) {
        errors[acc.platform] = `No adapter found for ${acc.platform}`;
        continue;
      }

      try {
        console.log(`[InstantPublish] Publishing to ${acc.platform} (${acc.name})...`);
        const pubResult = await adapter.publishVideo({
          video: targetFile,
          metadata: aiMetadata,
          account: acc
        });
        results[acc.platform] = {
          success: true,
          accountName: acc.name,
          postId: pubResult.postId,
          postUrl: pubResult.postUrl || pubResult.url,
          message: pubResult.message || `সফলভাবে ${acc.platform.toUpperCase()} এ আপলোড হয়েছে!`
        };

        // Record in publishedPosts
        updateDb(draft => {
          if (!draft.publishedPosts) draft.publishedPosts = [];
          draft.publishedPosts.unshift({
            id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            fileId: targetFile.fileId,
            platform: acc.platform,
            accountId: acc.id,
            accountName: acc.name,
            postUrl: pubResult.postUrl || pubResult.url || '',
            publishedAt: new Date().toISOString()
          });

          if (draft.driveFiles && draft.driveFiles[targetFile.fileId]) {
            draft.driveFiles[targetFile.fileId].status = 'published';
          }
        });
      } catch (err) {
        console.error(`[InstantPublish] Error publishing to ${acc.platform}:`, err.message);
        errors[acc.platform] = err.message;
      }
    }

    const hasSuccess = Object.keys(results).length > 0;
    const errorMessages = Object.entries(errors).map(([p, m]) => `${p.toUpperCase()}: ${m}`).join(' | ');

    addAuditLog('scheduler', `টেস্ট ভিডিও ইনস্ট্যান্ট আপলোড সম্পন্ন: "${targetFile.title || targetFile.name}" (সফল: ${Object.keys(results).length}, ব্যর্থ: ${Object.keys(errors).length})`);

    return res.status(hasSuccess ? 200 : 400).json({
      success: hasSuccess,
      error: hasSuccess ? null : (errorMessages || 'ভিডিও প্রসেসিং বা সোশ্যাল প্ল্যাটফর্মে আপলোড করতে সমস্যা হয়েছে।'),
      video: {
        fileId: targetFile.fileId,
        name: targetFile.name,
        title: targetFile.title
      },
      captions: aiMetadata,
      results,
      errors
    });
  } catch (globalErr) {
    console.error('[InstantPublish] Global error:', globalErr);
    return res.status(500).json({
      success: false,
      error: `সার্ভার ত্রুটি: ${globalErr.message}`
    });
  }
});

module.exports = router;
