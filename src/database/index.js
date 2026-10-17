const fs = require('fs');
const path = require('path');
const config = require('../config');
const crypto = require('../security/crypto');

const DB_FILE = process.env.VERCEL
  ? path.join('/tmp', 'database.json')
  : path.join(config.DATA_DIR, 'database.json');
const ORIGINAL_DB_FILE = path.join(__dirname, '../../data', 'database.json');

// Initial Schema
const DEFAULT_STATE = {
  settings: {
    dailyLimit: 3,
    timezone: 'Asia/Dhaka',
    reviewMode: true,           // Default: review captions before publishing
    autoPublishEnabled: false,
    preferredLanguage: 'bn',     // 'bn', 'en', 'banglish'
    captionStyle: 'entertaining',// 'entertaining', 'educational', 'storytelling', 'professional', 'promotional'
    geminiModel: 'gemini-2.5-flash',
    dailyGeminiLimit: 50,
    selectedFolderId: '1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5',
    selectedFolderName: 'Google Drive Videos',
    publishTimes: ['10:00', '14:00', '20:00'],
    defaultPrivacy: 'public',
    perPlatformSettings: {
      youtube: { enabled: true, privacy: 'public', category: '27' },
      facebook: { enabled: true, publishAsReels: true },
      instagram: { enabled: true, publishAsReels: true },
      tiktok: { enabled: true, directPost: true }
    }
  },
  accounts: [
    {
      id: 'acc_yt_1',
      platform: 'youtube',
      name: 'YouTube Shorts Channel',
      handle: '@YouTubeChannel',
      connected: false,
      tokenEncrypted: '',
      channelId: null,
      lastVerified: null
    },
    {
      id: 'acc_fb_1',
      platform: 'facebook',
      name: 'Facebook Page Reels',
      handle: '@FacebookPage',
      connected: false,
      pageId: null,
      tokenEncrypted: '',
      lastVerified: null
    },
    {
      id: 'acc_ig_1',
      platform: 'instagram',
      name: 'Instagram Professional',
      handle: '@InstagramReels',
      connected: false,
      igUserId: null,
      tokenEncrypted: '',
      lastVerified: null
    },
    {
      id: 'acc_tt_1',
      platform: 'tiktok',
      name: 'TikTok Creator Account',
      handle: '@TikTokCreator',
      connected: false,
      tokenEncrypted: '',
      lastVerified: null
    }
  ],
  driveFiles: {},     // fileId -> { fileId, name, size, mimeType, modifiedTime, thumbnail, excluded, status }
  aiAnalyses: {},     // fileId -> { analysis, generatedAt, tokenUsage }
  queueJobs: [],      // array of { id, fileId, status, scheduledDate, approved, platforms, attempts, error, result }
  publishedPosts: [], // array of { id, fileId, platform, accountId, postUrl, publishedAt }
  geminiUsage: {
    dates: {}         // 'YYYY-MM-DD' -> { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
  },
  auditLogs: []       // array of { id, timestamp, type, message, meta }
};

let dbCache = null;

function ensureDataDirectory() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(config.TEMP_DIR)) {
    fs.mkdirSync(config.TEMP_DIR, { recursive: true });
  }
}

function loadDatabase() {
  ensureDataDirectory();
  if (process.env.VERCEL && !fs.existsSync(DB_FILE) && fs.existsSync(ORIGINAL_DB_FILE)) {
    try {
      fs.copyFileSync(ORIGINAL_DB_FILE, DB_FILE);
    } catch (e) {}
  }
  if (!fs.existsSync(DB_FILE)) {
    saveDatabase(DEFAULT_STATE);
    dbCache = JSON.parse(JSON.stringify(DEFAULT_STATE));
    return dbCache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) {
      return dbCache || JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
    const parsed = JSON.parse(raw);
    dbCache = parsed;
    // Ensure all default top-level keys exist
    for (const key of Object.keys(DEFAULT_STATE)) {
      if (!dbCache[key]) {
        dbCache[key] = JSON.parse(JSON.stringify(DEFAULT_STATE[key]));
      }
    }
    return dbCache;
  } catch (err) {
    console.error('[Database] Transient read error in database.json:', err.message);
    if (dbCache) return dbCache;
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

let lastMtime = 0;

function saveDatabase(data) {
  ensureDataDirectory();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    dbCache = data;
    try { lastMtime = fs.statSync(DB_FILE).mtimeMs; } catch (e) {}
  } catch (err) {
    console.error('[Database] Direct write failed:', err.message);
  }
}

function getDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const stats = fs.statSync(DB_FILE);
      if (!dbCache || stats.mtimeMs > lastMtime) {
        loadDatabase();
        lastMtime = stats.mtimeMs;
      }
    } else if (!dbCache) {
      loadDatabase();
    }
  } catch (e) {
    if (!dbCache) loadDatabase();
  }
  return dbCache;
}

function updateDb(updaterFn) {
  const db = getDb();
  updaterFn(db);
  saveDatabase(db);
  return db;
}

function addAuditLog(type, message, meta = {}) {
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    meta
  };
  updateDb(db => {
    if (!db.auditLogs) db.auditLogs = [];
    db.auditLogs.unshift(logEntry);
    if (db.auditLogs.length > 500) {
      db.auditLogs = db.auditLogs.slice(0, 500);
    }
  });
  return logEntry;
}

module.exports = {
  getDb,
  updateDb,
  addAuditLog,
  loadDatabase,
  saveDatabase
};
