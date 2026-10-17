const express = require('express');
const router = express.Router();
const { getDb, updateDb, addAuditLog } = require('../database');
const costTracker = require('../services/costTracker');
const config = require('../config');

// Get settings and cost breakdown
router.get('/', (req, res) => {
  const db = getDb();
  const costStats = costTracker.getCostStats();

  res.json({
    success: true,
    settings: db.settings,
    costStats,
    envStatus: {
      hasGeminiKey: !!config.GEMINI_API_KEY,
      geminiModel: db.settings.geminiModel || config.GEMINI_MODEL,
      hasGoogleOAuth: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    }
  });
});

// Update settings
router.post('/', (req, res) => {
  const {
    dailyLimit,
    timezone,
    reviewMode,
    autoPublishEnabled,
    preferredLanguage,
    captionStyle,
    geminiModel,
    dailyGeminiLimit,
    defaultPrivacy,
    publishTimes
  } = req.body;

  updateDb(draft => {
    if (dailyLimit !== undefined) draft.settings.dailyLimit = parseInt(dailyLimit, 10) || 3;
    if (timezone !== undefined) draft.settings.timezone = timezone;
    if (reviewMode !== undefined) draft.settings.reviewMode = !!reviewMode;
    if (autoPublishEnabled !== undefined) draft.settings.autoPublishEnabled = !!autoPublishEnabled;
    if (preferredLanguage !== undefined) draft.settings.preferredLanguage = preferredLanguage;
    if (captionStyle !== undefined) draft.settings.captionStyle = captionStyle;
    if (geminiModel !== undefined) draft.settings.geminiModel = geminiModel;
    if (dailyGeminiLimit !== undefined) draft.settings.dailyGeminiLimit = parseInt(dailyGeminiLimit, 10) || 50;
    if (defaultPrivacy !== undefined) draft.settings.defaultPrivacy = defaultPrivacy;
    if (Array.isArray(publishTimes)) draft.settings.publishTimes = publishTimes;
  });

  addAuditLog('settings', 'সিস্টেম সেটিংস সফলভাবে আপডেট করা হয়েছে।');
  res.json({ success: true, message: 'Settings saved.' });
});

module.exports = router;
