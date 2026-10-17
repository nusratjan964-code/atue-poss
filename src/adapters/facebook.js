const fs = require('fs');
const BaseAdapter = require('./baseAdapter');
const crypto = require('../security/crypto');
const googleDrive = require('../services/googleDrive');

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class FacebookAdapter extends BaseAdapter {
  constructor() {
    super('facebook');
  }

  isConfigured(account) {
    const hasToken = !!(account?.tokenEncrypted || account?.token);
    return !!(account && account.connected && hasToken);
  }

  validateMetadata(metadata) {
    const caption = metadata?.caption || '';
    if (!caption.trim()) {
      return { valid: false, error: 'Facebook caption cannot be empty.' };
    }
    return { valid: true };
  }

  cleanPageIdentifier(raw) {
    if (!raw) return '';
    let str = String(raw).trim();
    str = str.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '');
    str = str.replace(/\/$/, '');
    str = str.replace(/^@/, '');
    const idMatch = str.match(/id=(\d+)/);
    if (idMatch) return idMatch[1];
    str = str.split('?')[0].split('#')[0];
    return str.trim();
  }

  /**
   * Tests Facebook Page Access Token and retrieves managed Pages.
   */
  async testConnection(account) {
    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    if (!rawToken) {
      return {
        connected: false,
        status: 'NOT_CONFIGURED',
        message: 'Facebook Page Access Token অনুপস্থিত। Social Accounts-এ টোকেন যুক্ত করুন।'
      };
    }

    try {
      // 1. Check if token is for a Page directly or User Token
      let pageId = this.cleanPageIdentifier(account?.pageId || account?.handle);
      
      // If pageId looks numeric, verify directly
      if (/^\d+$/.test(pageId)) {
        const res = await fetch(`${GRAPH_BASE}/${pageId}?fields=id,name,link,verification_status&access_token=${rawToken}`);
        const data = await res.json();

        if (res.ok && data.id) {
          return {
            connected: true,
            status: 'VERIFIED',
            pageId: data.id,
            pageName: data.name,
            link: data.link,
            message: `✅ Facebook Page লাইভ কানেকশন সফল! পেজ: "${data.name}" (ID: ${data.id})`
          };
        }
      }

      // Check /me/accounts for user token to list managed pages
      const meRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,category,access_token,tasks&access_token=${rawToken}`);
      const meData = await meRes.json();

      if (meRes.ok && meData.data && meData.data.length > 0) {
        const pages = meData.data.map(p => ({ id: p.id, name: p.name, category: p.category }));
        const matchedPage = pageId ? pages.find(p => p.id === pageId || p.name.toLowerCase() === pageId.toLowerCase()) : pages[0];
        const selected = matchedPage || pages[0];

        return {
          connected: true,
          status: 'VERIFIED',
          pageId: selected.id,
          pageName: selected.name,
          managedPages: pages,
          message: `✅ Meta Graph API কানেকশন সক্রিয়! পেজ: "${selected.name}" (মোট ${pages.length}টি পরিচালিত পেজ পাওয়া গেছে)`
        };
      }

      // If me query failed, report error
      const err = meData.error || { message: 'Invalid token or page not found' };
      return {
        connected: false,
        status: 'FAILED',
        error: err.message,
        type: err.type,
        message: `Facebook টোকেন যাচাই ব্যর্থ: ${err.message}`
      };
    } catch (err) {
      return {
        connected: false,
        status: 'FAILED',
        error: err.message,
        message: `Facebook কানেকশন এরর: ${err.message}`
      };
    }
  }

  /**
   * Publishes Facebook Reel via official Meta Graph API Video Reels Workflow.
   */
  async publishVideo({ video, metadata, account, options = {} }) {
    const fbMeta = metadata?.facebook || {
      caption: `${video.title || 'বাংলা AI রিলস'}\n\n#Reels #Viral #BanglaAI`,
      hashtags: ['#Reels', '#Viral']
    };

    const validation = this.validateMetadata(fbMeta);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    if (!rawToken) {
      throw new Error('Facebook Page access token is missing. Please configure a valid Page Access Token in Social Accounts.');
    }

    let pageId = this.cleanPageIdentifier(account?.pageId || account?.handle);
    const fullCaption = `${fbMeta.caption}\n\n${(fbMeta.hashtags || []).join(' ')}`.trim();

    // Download video file from Drive to ensure real bytes
    let tempFilePath = null;
    let fileSize = 0;

    try {
      const dl = await googleDrive.downloadVideoToTempFile(video.fileId);
      tempFilePath = dl.filePath;
      fileSize = dl.sizeBytes;
    } catch (dlErr) {
      throw new Error(`Failed to download source video from Drive for Facebook upload: ${dlErr.message}`);
    }

    try {
      // Step 1: Start Reels Upload Session
      console.log(`[Facebook Adapter] Initializing Reels upload session for pageId=${pageId}...`);
      const startRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/video_reels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
          access_token: rawToken
        })
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.video_id) {
        // Fallback: If video_reels not allowed on this page, try direct video upload
        console.warn(`[Facebook Adapter] video_reels start failed: ${startData.error?.message}. Attempting Page Videos API...`);
        return await this.uploadViaPageVideosApi({
          pageId,
          token: rawToken,
          caption: fullCaption,
          filePath: tempFilePath,
          title: video.title
        });
      }

      const videoId = startData.video_id;
      const uploadUrl = startData.upload_url;

      // Step 2: Upload Binary Bytes to upload_url
      console.log(`[Facebook Adapter] Uploading video binary (${fileSize} bytes) to upload_url...`);
      const fileBuffer = fs.readFileSync(tempFilePath);

      const binaryUploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${rawToken}`,
          'offset': '0',
          'file_size': String(fileSize)
        },
        body: fileBuffer
      });

      const binaryData = await binaryUploadRes.json().catch(() => ({}));
      if (!binaryUploadRes.ok && binaryData.success !== true) {
        throw new Error(`Facebook Reels binary upload failed: HTTP ${binaryUploadRes.status} ${JSON.stringify(binaryData)}`);
      }

      // Step 3: Finish Upload & Publish
      console.log(`[Facebook Adapter] Finishing Reels session for video_id=${videoId}...`);
      const finishRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/video_reels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          description: fullCaption,
          access_token: rawToken
        })
      });

      const finishData = await finishRes.json();
      if (!finishRes.ok || finishData.success !== true) {
        throw new Error(`Facebook Reels finish phase failed: ${finishData.error?.message || JSON.stringify(finishData)}`);
      }

      const genuineReelUrl = `https://www.facebook.com/reel/${videoId}`;
      return {
        success: true,
        platform: 'facebook',
        live: true,
        status: 'published',
        postId: videoId,
        postUrl: genuineReelUrl,
        rawResponse: { videoId, finish: finishData },
        message: `✅ Facebook Reel সফলভাবে আপলোড ও প্রকাশিত হয়েছে (ID: ${videoId})`
      };
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
    }
  }

  /**
   * Fallback: Upload as Page Video via standard videos endpoint with multipart/form-data.
   */
  async uploadViaPageVideosApi({ pageId, token, caption, filePath, title }) {
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('description', caption);
    if (title) formData.append('title', title);
    formData.append('access_token', token);
    formData.append('source', new Blob([fileBuffer], { type: 'video/mp4' }), 'video.mp4');

    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/videos`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Facebook Page Video upload failed: ${data.error?.message || res.statusText}`);
    }

    const postUrl = `https://www.facebook.com/reel/${data.id}`;
    return {
      success: true,
      platform: 'facebook',
      live: true,
      status: 'published',
      postId: data.id,
      postUrl,
      rawResponse: data,
      message: `✅ Facebook Video/Reel সফলভাবে প্রকাশিত হয়েছে (ID: ${data.id})`
    };
  }
}

module.exports = FacebookAdapter;
