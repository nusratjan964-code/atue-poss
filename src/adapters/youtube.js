const fs = require('fs');
const https = require('https');
const BaseAdapter = require('./baseAdapter');
const crypto = require('../security/crypto');
const googleAuth = require('../services/googleAuth');
const googleDrive = require('../services/googleDrive');

class YouTubeAdapter extends BaseAdapter {
  constructor() {
    super('youtube');
  }

  isConfigured(account) {
    const hasToken = !!(account?.tokenEncrypted || account?.token);
    return !!(account && account.connected && hasToken);
  }

  validateMetadata(metadata) {
    const title = metadata?.title || '';
    const description = metadata?.description || '';

    if (!title.trim()) {
      return { valid: false, error: 'YouTube Shorts title cannot be empty.' };
    }
    if (title.length > 100) {
      return { valid: false, error: `YouTube title exceeds 100 characters limit (actual: ${title.length}).` };
    }
    if (description.length > 5000) {
      return { valid: false, error: `YouTube description exceeds 5000 characters.` };
    }

    return { valid: true };
  }

  /**
   * Test YouTube Data API connection and token validity.
   */
  async testConnection(account) {
    let token = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    if (!token) {
      // Try resolving through Google OAuth service
      token = await googleAuth.getValidAccessToken();
    }

    if (!token) {
      return {
        connected: false,
        status: 'NOT_CONFIGURED',
        message: 'YouTube OAuth এক্সেস টোকেন পাওয়া যায়নি। "Connect Google" বাটনে ক্লিক করে চ্যানেল অনুমোদন করুন।'
      };
    }

    try {
      const channel = await googleAuth.fetchYouTubeChannel(token);
      if (!channel) {
        return {
          connected: false,
          status: 'NO_CHANNEL_FOUND',
          message: 'Google অ্যাকাউন্ট সংযুক্ত আছে, কিন্তু কোনো সক্রিয় YouTube চ্যানেল পাওয়া যায়নি।'
        };
      }

      return {
        connected: true,
        status: 'VERIFIED',
        channelId: channel.id,
        channelTitle: channel.title,
        customUrl: channel.customUrl,
        message: `✅ YouTube Data API v3 কানেকশন সফল! চ্যানেল: "${channel.title}" (${channel.customUrl || channel.id})`
      };
    } catch (err) {
      return {
        connected: false,
        status: 'FAILED',
        error: err.message,
        message: `YouTube API যাচাইকরণ ত্রুটি: ${err.message}`
      };
    }
  }

  /**
   * Publishes video via YouTube Data API v3 Resumable Upload.
   */
  async publishVideo({ video, metadata, account, options = {} }) {
    const ytMeta = metadata?.youtube || {
      title: `${video.title || 'বাংলা AI রিলস'} #Shorts`,
      description: `${video.title || ''}\n\n#Shorts #BanglaAI #Trending`,
      tags: ['#Shorts', '#Viral', '#BanglaAI']
    };

    const validation = this.validateMetadata(ytMeta);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Resolve freshest access token
    let token = await googleAuth.getValidAccessToken();
    if (!token && account?.tokenEncrypted) {
      token = crypto.decrypt(account.tokenEncrypted);
    }

    if (!token) {
      throw new Error('YouTube OAuth access token is missing or expired. Please connect your YouTube channel via Google OAuth in Social Accounts.');
    }

    const privacy = options.privacy || 'public';
    const categoryId = options.category || '27'; // 27 = Education, 22 = People & Blogs, 24 = Entertainment

    console.log(`[YouTube Adapter] Initiating live YouTube Data API upload: "${ytMeta.title}", privacy=${privacy}`);

    // Step 1: Ensure local video file is downloaded for streaming
    let tempFilePath = null;
    let fileSize = 0;

    try {
      const dl = await googleDrive.downloadVideoToTempFile(video.fileId);
      tempFilePath = dl.filePath;
      fileSize = dl.sizeBytes;
    } catch (dlErr) {
      throw new Error(`Failed to download source video from Google Drive for YouTube upload: ${dlErr.message}`);
    }

    try {
      // Step 2: Create resumable upload session
      const uploadUrl = await this.createResumableSession({
        token,
        title: ytMeta.title,
        description: ytMeta.description,
        tags: ytMeta.tags || ['#Shorts'],
        privacy,
        categoryId,
        fileSize
      });

      // Step 3: Stream video bytes to YouTube upload URL
      const uploadedVideo = await this.uploadVideoContent({
        uploadUrl,
        filePath: tempFilePath,
        fileSize
      });

      if (!uploadedVideo || !uploadedVideo.id) {
        throw new Error('YouTube Data API did not return a valid video ID.');
      }

      const canonicalUrl = `https://youtube.com/shorts/${uploadedVideo.id}`;
      return {
        success: true,
        platform: 'youtube',
        live: true,
        status: 'published',
        postId: uploadedVideo.id,
        postUrl: canonicalUrl,
        rawResponse: uploadedVideo,
        message: `✅ YouTube Shorts সফলভাবে আপলোড ও প্রকাশিত হয়েছে (ID: ${uploadedVideo.id})`
      };
    } finally {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
    }
  }

  createResumableSession({ token, title, description, tags, privacy, categoryId, fileSize }) {
    return new Promise((resolve, reject) => {
      const sessionBody = JSON.stringify({
        snippet: {
          title,
          description,
          tags,
          categoryId
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false
        }
      });

      const req = https.request({
        hostname: 'www.googleapis.com',
        port: 443,
        path: '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'Content-Length': Buffer.byteLength(sessionBody),
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize)
        }
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.headers.location) {
            resolve(res.headers.location);
          } else {
            let errMsg = `YouTube Resumable Session Error (HTTP ${res.statusCode}): ${body}`;
            try {
              const j = JSON.parse(body);
              if (j.error?.message) errMsg = `YouTube API Error: ${j.error.message}`;
            } catch (e) {}
            reject(new Error(errMsg));
          }
        });
      });

      req.on('error', reject);
      req.write(sessionBody);
      req.end();
    });
  }

  uploadVideoContent({ uploadUrl, filePath, fileSize }) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(uploadUrl);
      const fileStream = fs.createReadStream(filePath);

      const req = https.request({
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(fileSize)
        }
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              resolve(json);
            } catch (e) {
              reject(new Error(`Invalid JSON from YouTube upload: ${body}`));
            }
          } else {
            reject(new Error(`YouTube Video Upload failed (HTTP ${res.statusCode}): ${body}`));
          }
        });
      });

      req.on('error', reject);
      fileStream.pipe(req);
    });
  }
}

module.exports = YouTubeAdapter;
