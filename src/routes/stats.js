const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const scheduler = require('../services/scheduler');
const config = require('../config');

router.get('/dashboard', (req, res) => {
  const db = getDb();
  const publishedToday = scheduler.getPublishedCountToday();
  const dailyLimit = db.settings.dailyLimit || 3;

  const queue = db.queueJobs || [];
  const analyzingCount = queue.filter(j => j.status === 'analyzing').length;
  const awaitingApprovalCount = queue.filter(j => j.status === 'awaiting_approval').length;
  const failedCount = queue.filter(j => j.status === 'failed').length;
  const verifiedPublishedPosts = (db.publishedPosts || []).filter(p => 
    p.verified === true && p.status !== 'simulated' && p.status !== 'unverified' && p.status !== 'failed'
  );
  const totalPublishedPosts = verifiedPublishedPosts.length;
  const totalDriveVideos = Object.keys(db.driveFiles || {}).length;

  const googleTokens = db.settings.googleTokens;
  const isGoogleAuthenticated = !!(googleTokens?.accessTokenEncrypted && (!googleTokens.expiresAt || Date.now() < googleTokens.expiresAt));

  res.json({
    success: true,
    stats: {
      todayCount: publishedToday,
      dailyLimit: dailyLimit,
      queueCount: queue.filter(j => j.status === 'pending').length,
      analyzingCount,
      awaitingApprovalCount,
      totalPublishedCount: totalPublishedPosts,
      failedCount,
      totalDriveVideos
    },
    systemStatus: {
      googleDriveConnected: isGoogleAuthenticated,
      googleDriveAuthenticated: isGoogleAuthenticated,
      googleAccountEmail: db.settings.googleAccountEmail || null,
      geminiConnected: !!config.GEMINI_API_KEY,
      geminiModel: db.settings.geminiModel || config.GEMINI_MODEL,
      schedulerRunning: true,
      timezone: db.settings.timezone || 'Asia/Dhaka',
      reviewMode: db.settings.reviewMode !== false,
      autoPublishEnabled: !!db.settings.autoPublishEnabled
    },
    accounts: (db.accounts || []).map(a => ({
      id: a.id,
      platform: a.platform,
      name: a.name,
      handle: a.handle,
      connected: !!a.connected,
      verified: !!a.verified,
      hasToken: !!a.tokenEncrypted
    })),
    recentActivity: (db.auditLogs || []).slice(0, 20),
    recentPublished: (db.publishedPosts || []).slice(-10).reverse()
  });
});

module.exports = router;
