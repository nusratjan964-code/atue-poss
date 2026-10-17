const express = require('express');
const path = require('path');
const config = require('./src/config');
const { getDb, addAuditLog } = require('./src/database');
const scheduler = require('./src/services/scheduler');
const googleDrive = require('./src/services/googleDrive');
const { getAdapter } = require('./src/adapters');

const app = express();

// Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS & Security Headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Fallback for root assets

// Mount REST API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/drive', require('./src/routes/drive'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/queue', require('./src/routes/queue'));
app.use('/api/accounts', require('./src/routes/accounts'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/stats', require('./src/routes/stats'));

// ==============================================================================
// Backward-Compatibility Endpoints (Preserves legacy integrations)
// ==============================================================================

app.post('/api/fetch-drive-videos', async (req, res) => {
  try {
    const folderId = req.body.driveUrl || req.body.folderId || '1MpjJrnwTjXkVmm9u26-V48SflOWGz5y5';
    const result = await googleDrive.getDriveVideos(folderId);
    res.json({
      success: true,
      folderId: result.folderId,
      folderTitle: result.folderTitle,
      totalFiles: result.totalFiles,
      files: result.files
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/publish-to-facebook', async (req, res) => {
  try {
    const { pageId, token, driveFileId, title, description } = req.body;
    const fbAdapter = getAdapter('facebook');
    const result = await fbAdapter.publishVideo({
      video: { fileId: driveFileId, title },
      metadata: { facebook: { caption: description || title } },
      account: { pageId, token, connected: true }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stream-video', (req, res) => {
  const fileId = req.query.fileId || req.query.id;
  googleDrive.streamDriveVideo(fileId, req, res);
});

app.get('/api/drive-thumb', (req, res) => {
  const fileId = req.query.id || req.query.fileId;
  res.redirect(`/api/drive/thumb?id=${fileId}`);
});

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Single Page Application Fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: `API route ${req.method} ${req.path} not found` });
  }
  const indexPath = path.resolve(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err && !res.headersSent) {
      res.status(err.status || 404).end();
    }
  });
});

// Global Error Handler (Always return JSON for API requests)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON request payload format.' });
  }
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Start Server & Background Scheduler if not on serverless
const PORT = config.PORT;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 Drive2Social AI Engine`);
    console.log(`📡 Server running at: http://localhost:${PORT}`);
    console.log(`⏱️ Default Timezone: ${config.DEFAULT_TIMEZONE} (Max 3 videos/day)`);
    console.log(`🤖 Gemini Model: ${config.GEMINI_MODEL}`);
    console.log('====================================================');

    // Initialize background scheduler
    scheduler.startScheduler(60000); // Polls every 60 seconds
    addAuditLog('system', `Drive2Social AI সার্ভার সফলভাবে চালু হয়েছে (Port: ${PORT})`);
  });
}

module.exports = app;
