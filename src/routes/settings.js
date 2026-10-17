const express = require('express');
const router = express.Router();
const { getDb, updateDb, addAuditLog } = require('../database');
const costTracker = require('../services/costTracker');
const config = require('../config');

const fs = require('fs');
const path = require('path');
const googleAuth = require('../services/googleAuth');

function updateEnvFile(keyValues) {
  try {
    const envPath = path.join(__dirname, '../../.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }
    for (const [key, val] of Object.entries(keyValues)) {
      if (val === undefined || val === null) continue;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${val}`);
      } else {
        content += `\n${key}=${val}`;
      }
    }
    fs.writeFileSync(envPath, content.trim() + '\n', 'utf8');
  } catch (err) {
    console.warn('[Settings] Failed to update .env:', err.message);
  }
}

// Get settings and cost breakdown
router.get('/', (req, res) => {
  const db = getDb();
  const costStats = costTracker.getCostStats();
  const { clientId, clientSecret } = googleAuth.getGoogleCredentials();

  res.json({
    success: true,
    settings: {
      ...db.settings,
      googleClientId: clientId,
      hasGoogleClientSecret: !!clientSecret,
      geminiApiKey: db.settings.geminiApiKey || config.GEMINI_API_KEY || ''
    },
    costStats,
    envStatus: {
      hasGeminiKey: !!(db.settings.geminiApiKey || config.GEMINI_API_KEY),
      geminiModel: db.settings.geminiModel || config.GEMINI_MODEL,
      hasGoogleOAuth: !!(clientId && clientSecret),
      googleRedirectUri: config.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
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
    publishTimes,
    googleClientId,
    googleClientSecret,
    geminiApiKey
  } = req.body;

  const envUpdates = {};

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

    if (googleClientId !== undefined) {
      draft.settings.googleClientId = googleClientId.trim();
      config.GOOGLE_CLIENT_ID = googleClientId.trim();
      envUpdates.GOOGLE_CLIENT_ID = googleClientId.trim();
    }
    if (googleClientSecret !== undefined && googleClientSecret.trim()) {
      draft.settings.googleClientSecret = googleClientSecret.trim();
      config.GOOGLE_CLIENT_SECRET = googleClientSecret.trim();
      envUpdates.GOOGLE_CLIENT_SECRET = googleClientSecret.trim();
    }
    if (geminiApiKey !== undefined && geminiApiKey.trim()) {
      draft.settings.geminiApiKey = geminiApiKey.trim();
      config.GEMINI_API_KEY = geminiApiKey.trim();
      process.env.GEMINI_API_KEY = geminiApiKey.trim();
      envUpdates.GEMINI_API_KEY = geminiApiKey.trim();
    }
  });

  if (Object.keys(envUpdates).length > 0) {
    updateEnvFile(envUpdates);
  }

  addAuditLog('settings', 'সিস্টেম ও সোশ্যাল এপিআই সেটিংস সফলভাবে আপডেট করা হয়েছে।');
  res.json({ success: true, message: 'Settings saved.' });
});

module.exports = router;
