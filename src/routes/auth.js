const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../database');
const googleAuth = require('../services/googleAuth');
const googleDrive = require('../services/googleDrive');

// Status of Google OAuth & Gemini
router.get('/status', async (req, res) => {
  const db = getDb();
  const { clientId, clientSecret } = googleAuth.getGoogleCredentials();
  const googleConfigured = !!(clientId && clientSecret);
  const googleTokens = db.settings.googleTokens;
  const hasAccessToken = !!googleTokens?.accessTokenEncrypted;
  const isExpired = googleTokens?.expiresAt ? Date.now() > googleTokens.expiresAt : false;
  const geminiConfigured = !!config.GEMINI_API_KEY;

  res.json({
    google: {
      configured: googleConfigured,
      connected: hasAccessToken,
      isExpired,
      email: db.settings.googleAccountEmail || null,
      name: db.settings.googleAccountName || null,
      picture: db.settings.googleAccountPicture || null,
      scope: googleTokens?.scope || null,
      expiresAt: googleTokens?.expiresAt || null,
      selectedFolderId: db.settings.selectedFolderId,
      selectedFolderName: db.settings.selectedFolderName,
      syncAuthenticated: !!db.settings.driveSyncAuthenticated
    },
    gemini: {
      configured: geminiConfigured,
      model: db.settings.geminiModel || config.GEMINI_MODEL
    }
  });
});

// Generate Google OAuth URL
router.get('/google/url', (req, res) => {
  try {
    const authUrl = googleAuth.getAuthUrl('', req);
    res.json({ url: authUrl });
  } catch (err) {
    res.status(400).json({
      error: err.message,
      instructions: 'Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.'
    });
  }
});

// OAuth Callback: Exchanges code for real Google & YouTube tokens
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; background: #0f172a; color: #ef4444; text-align: center; padding: 50px;">
          <h2>❌ Google Authorization Denied</h2>
          <p>${error}</p>
          <a href="/" style="color: #60a5fa;">Back to Dashboard</a>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code from Google.');
  }

  try {
    const result = await googleAuth.exchangeCodeForTokens(code, req);
    const email = result.profile?.email || 'Authorized User';

    res.send(`
      <html>
        <head>
          <title>Google Account Connected</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 50px; }
            .card { background: #1e293b; border-radius: 12px; padding: 30px; max-width: 500px; margin: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h2 { color: #10b981; margin-bottom: 10px; }
            p { color: #94a3b8; }
            .badge { display: inline-block; background: #065f46; color: #34d399; padding: 6px 14px; border-radius: 20px; font-weight: bold; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✅ Google Account Connected!</h2>
            <div class="badge">${email}</div>
            <p>Google Drive API v3 and YouTube Data API v3 are now authorized with offline access token renewal.</p>
            <p>Returning to dashboard in 2 seconds...</p>
          </div>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.location.reload();
                window.close();
              } else {
                window.location.href = '/';
              }
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; background: #0f172a; color: #ef4444; text-align: center; padding: 50px;">
          <h2>❌ Token Exchange Failed</h2>
          <p>${err.message}</p>
          <a href="/" style="color: #60a5fa;">Back to Dashboard</a>
        </body>
      </html>
    `);
  }
});

// Disconnect Google Account
router.post('/disconnect', (req, res) => {
  const result = googleAuth.disconnectGoogle();
  res.json(result);
});

// Test Google Drive & OAuth Connection
router.get('/test-drive', async (req, res) => {
  try {
    const result = await googleDrive.testDriveConnection();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
