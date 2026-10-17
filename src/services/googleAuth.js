const config = require('../config');
const crypto = require('../security/crypto');
const { getDb, updateDb, addAuditLog } = require('../database');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * Returns Google OAuth Authorization URL.
 */
function getAuthUrl(state = '') {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured in .env file.');
  }

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });

  if (state) params.set('state', state);

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for access and refresh tokens.
 */
async function exchangeCodeForTokens(code) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    }).toString()
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Google token exchange failed: ${data.error_description || data.error || response.statusText}`);
  }

  const now = Date.now();
  const tokenPayload = {
    accessTokenEncrypted: crypto.encrypt(data.access_token),
    refreshTokenEncrypted: data.refresh_token ? crypto.encrypt(data.refresh_token) : null,
    expiresAt: now + ((data.expires_in || 3600) * 1000),
    scope: data.scope,
    tokenType: data.token_type || 'Bearer',
    updatedAt: new Date().toISOString()
  };

  // Fetch connected profile information
  let profile = null;
  try {
    profile = await fetchGoogleUserInfo(data.access_token);
  } catch (err) {
    console.warn('[GoogleAuth] Failed to fetch user profile:', err.message);
  }

  // Fetch YouTube channel information if scope granted
  let ytChannel = null;
  try {
    ytChannel = await fetchYouTubeChannel(data.access_token);
  } catch (err) {
    console.warn('[GoogleAuth] Failed to fetch YouTube channel:', err.message);
  }

  // Persist tokens securely
  updateDb(draft => {
    if (!draft.settings.googleTokens) draft.settings.googleTokens = {};
    draft.settings.googleTokens = {
      ...tokenPayload,
      // Retain existing refresh token if Google didn't issue a new one
      refreshTokenEncrypted: tokenPayload.refreshTokenEncrypted || draft.settings.googleTokens.refreshTokenEncrypted
    };
    if (profile) {
      draft.settings.googleAccountEmail = profile.email;
      draft.settings.googleAccountName = profile.name;
      draft.settings.googleAccountPicture = profile.picture;
    }

    // Automatically sync YouTube account if channel found
    if (ytChannel) {
      if (!draft.accounts) draft.accounts = [];
      let ytAcc = draft.accounts.find(a => a.platform === 'youtube');
      if (!ytAcc) {
        ytAcc = { id: 'acc_yt_1', platform: 'youtube' };
        draft.accounts.push(ytAcc);
      }
      ytAcc.name = ytChannel.title;
      ytAcc.handle = ytChannel.customUrl ? `@${ytChannel.customUrl.replace(/^@/, '')}` : `@${ytChannel.id}`;
      ytAcc.channelId = ytChannel.id;
      ytAcc.connected = true;
      ytAcc.tokenEncrypted = tokenPayload.accessTokenEncrypted;
      ytAcc.lastVerified = new Date().toISOString();
      ytAcc.verified = true;
    }
  });

  addAuditLog('auth', `Google Account successfully authorized via OAuth (${profile?.email || 'authenticated'})`);
  return { tokens: tokenPayload, profile, ytChannel };
}

/**
 * Refreshes Google access token using the stored refresh token.
 */
async function refreshAccessToken() {
  const db = getDb();
  const tokens = db.settings.googleTokens;
  if (!tokens || !tokens.refreshTokenEncrypted) {
    throw new Error('No refresh token available to renew Google access token.');
  }

  const refreshToken = crypto.decrypt(tokens.refreshTokenEncrypted);
  if (!refreshToken) {
    throw new Error('Failed to decrypt stored Google refresh token.');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }

  const now = Date.now();
  const encryptedNewAccess = crypto.encrypt(data.access_token);
  const expiresAt = now + ((data.expires_in || 3600) * 1000);

  updateDb(draft => {
    if (!draft.settings.googleTokens) draft.settings.googleTokens = {};
    draft.settings.googleTokens.accessTokenEncrypted = encryptedNewAccess;
    draft.settings.googleTokens.expiresAt = expiresAt;
    draft.settings.googleTokens.updatedAt = new Date().toISOString();

    // Also update YouTube account token
    const ytAcc = (draft.accounts || []).find(a => a.platform === 'youtube');
    if (ytAcc) {
      ytAcc.tokenEncrypted = encryptedNewAccess;
      ytAcc.lastVerified = new Date().toISOString();
    }
  });

  return data.access_token;
}

/**
 * Gets a valid Google access token, automatically refreshing if close to expiry.
 */
async function getValidAccessToken() {
  const db = getDb();
  const tokens = db.settings.googleTokens;
  if (!tokens || !tokens.accessTokenEncrypted) {
    return null;
  }

  const now = Date.now();
  const expiry = tokens.expiresAt || 0;

  // If expired or expiring within 3 minutes, refresh
  if (expiry - now < 180000 && tokens.refreshTokenEncrypted) {
    try {
      return await refreshAccessToken();
    } catch (err) {
      console.warn('[GoogleAuth] Automatic token refresh failed:', err.message);
    }
  }

  try {
    return crypto.decrypt(tokens.accessTokenEncrypted);
  } catch (err) {
    console.error('[GoogleAuth] Failed to decrypt access token:', err.message);
    return null;
  }
}

/**
 * Fetches Google user profile info.
 */
async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google user info: HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Fetches authorized YouTube channel info for the authenticated user.
 */
async function fetchYouTubeChannel(accessToken) {
  const url = `${YOUTUBE_CHANNELS_URL}?part=snippet,contentDetails&mine=true`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`YouTube API Error: ${errData.error?.message || res.statusText}`);
  }
  const data = await res.json();
  if (data.items && data.items.length > 0) {
    const ch = data.items[0];
    return {
      id: ch.id,
      title: ch.snippet.title,
      description: ch.snippet.description,
      customUrl: ch.snippet.customUrl,
      thumbnail: ch.snippet.thumbnails?.default?.url
    };
  }
  return null;
}

/**
 * Disconnects the Google account and clears stored tokens.
 */
function disconnectGoogle() {
  updateDb(draft => {
    delete draft.settings.googleAccountEmail;
    delete draft.settings.googleAccountName;
    delete draft.settings.googleAccountPicture;
    delete draft.settings.googleTokens;

    const ytAcc = (draft.accounts || []).find(a => a.platform === 'youtube');
    if (ytAcc) {
      ytAcc.connected = false;
      ytAcc.tokenEncrypted = '';
      ytAcc.lastVerified = null;
      ytAcc.verified = false;
    }
  });
  addAuditLog('auth', 'Google Account disconnected and tokens cleared.');
  return { success: true };
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  fetchGoogleUserInfo,
  fetchYouTubeChannel,
  disconnectGoogle,
  REQUIRED_SCOPES
};
