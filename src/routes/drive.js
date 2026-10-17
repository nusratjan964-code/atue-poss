const express = require('express');
const router = express.Router();
const googleDrive = require('../services/googleDrive');
const { getDb } = require('../database');
const https = require('https');

// Sync folder
router.post('/sync', async (req, res) => {
  const { driveUrl, folderId } = req.body;
  const target = folderId || driveUrl;

  try {
    const result = await googleDrive.getDriveVideos(target);
    res.json({
      success: true,
      folderId: result.folderId,
      folderTitle: result.folderTitle,
      totalFiles: result.totalFiles,
      files: result.files.slice(0, 50)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List files with pagination and search
router.get('/files', (req, res) => {
  const db = getDb();
  let files = Object.values(db.driveFiles || {});

  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = (req.query.search || '').toLowerCase().trim();
  const filter = req.query.filter || 'all'; // 'all', 'active', 'excluded', 'published'

  if (search) {
    files = files.filter(f => 
      (f.name && f.name.toLowerCase().includes(search)) ||
      (f.title && f.title.toLowerCase().includes(search)) ||
      (f.fileId && f.fileId.toLowerCase().includes(search))
    );
  }

  if (filter === 'excluded') {
    files = files.filter(f => f.excluded);
  } else if (filter === 'active') {
    files = files.filter(f => !f.excluded);
  }

  const total = files.length;
  const startIndex = (page - 1) * limit;
  const paginated = files.slice(startIndex, startIndex + limit);

  res.json({
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    files: paginated
  });
});

// Toggle exclude
router.post('/exclude', (req, res) => {
  const { fileId, excluded } = req.body;
  if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

  const result = googleDrive.setFileExclusion(fileId, excluded !== false);
  res.json(result);
});

// Stream video with Range support
router.get('/stream', (req, res) => {
  const fileId = req.query.id || req.query.fileId;
  googleDrive.streamDriveVideo(fileId, req, res);
});

// Proxy thumbnail
router.get('/thumb', (req, res) => {
  const fileId = req.query.id || req.query.fileId;
  if (!fileId) return res.status(400).end('Missing id');

  const thumbUrl = `https://lh3.googleusercontent.com/d/${fileId}=w400`;
  https.get(thumbUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, proxyRes => {
    if (proxyRes.statusCode === 200) {
      res.writeHead(200, {
        'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
    } else {
      res.redirect(`https://drive.google.com/thumbnail?id=${fileId}&sz=w320`);
    }
  }).on('error', () => {
    res.status(404).end('Thumbnail unavailable');
  });
});

module.exports = router;
