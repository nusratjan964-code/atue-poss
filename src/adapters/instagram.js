const BaseAdapter = require('./baseAdapter');
const crypto = require('../security/crypto');
const googleDrive = require('../services/googleDrive');

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class InstagramAdapter extends BaseAdapter {
  constructor() {
    super('instagram');
  }

  isConfigured(account) {
    const hasToken = !!(account?.tokenEncrypted || account?.token);
    const hasIgId = !!(account?.igUserId || account?.pageId);
    return !!(account && account.connected && hasToken && hasIgId);
  }

  validateMetadata(metadata) {
    const caption = metadata?.caption || '';
    if (!caption.trim()) {
      return { valid: false, error: 'Instagram caption cannot be empty.' };
    }
    if (caption.length > 2200) {
      return { valid: false, error: `Instagram caption exceeds 2200 characters limit (${caption.length}).` };
    }
    const hashtags = metadata?.hashtags || [];
    if (hashtags.length > 30) {
      return { valid: false, error: `Instagram allows a maximum of 30 hashtags (found: ${hashtags.length}).` };
    }
    return { valid: true };
  }

  cleanIdentifier(raw) {
    if (!raw) return '';
    let str = String(raw).trim();
    str = str.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
    str = str.replace(/\/$/, '');
    str = str.replace(/^@/, '');
    return str.split('?')[0].split('#')[0].trim();
  }

  /**
   * Tests Instagram Professional Account credentials via Meta Graph API.
   */
  async testConnection(account) {
    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    const igId = this.cleanIdentifier(account?.igUserId || account?.handle);

    if (!rawToken) {
      return {
        connected: false,
        status: 'NOT_CONFIGURED',
        message: 'Instagram Graph API access token অনুপস্থিত। Social Accounts-এ টোকেন দিন।'
      };
    }

    if (!igId || !/^\d+$/.test(igId)) {
      // Check if user provided username or handle instead of numeric IG User ID
      try {
        // Query connected instagram accounts via pages
        const pagesRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${rawToken}`);
        const pagesData = await pagesRes.json();

        if (pagesRes.ok && pagesData.data) {
          const igAccounts = pagesData.data
            .filter(p => p.instagram_business_account)
            .map(p => ({
              pageName: p.name,
              igUserId: p.instagram_business_account.id,
              igUsername: p.instagram_business_account.username
            }));

          if (igAccounts.length > 0) {
            const first = igAccounts[0];
            return {
              connected: true,
              status: 'VERIFIED',
              igUserId: first.igUserId,
              igUsername: first.igUsername,
              availableAccounts: igAccounts,
              message: `✅ Instagram Professional একাউন্ট সংযুক্ত! @${first.igUsername} (ID: ${first.igUserId})`
            };
          }
        }
      } catch (e) {}

      return {
        connected: false,
        status: 'NUMERIC_ID_REQUIRED',
        message: 'Instagram Professional একাউন্টের জন্য numeric Instagram User ID প্রয়োজন (যেমন: 17841400...)।'
      };
    }

    try {
      const res = await fetch(`${GRAPH_BASE}/${igId}?fields=id,username,name,account_type,profile_picture_url&access_token=${rawToken}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        return {
          connected: false,
          status: 'FAILED',
          error: data.error?.message || `HTTP ${res.status}`,
          message: `Instagram যাচাইকরণ ব্যর্থ: ${data.error?.message || 'Invalid account or token'}`
        };
      }

      return {
        connected: true,
        status: 'VERIFIED',
        igUserId: data.id,
        igUsername: data.username,
        accountType: data.account_type,
        message: `✅ Instagram Professional একাউন্ট লাইভ ও যাচাইকৃত! @${data.username} (${data.account_type || 'Professional'})`
      };
    } catch (err) {
      return {
        connected: false,
        status: 'FAILED',
        error: err.message,
        message: `Instagram সংযোগ যাচাইয়ে ত্রুটি: ${err.message}`
      };
    }
  }

  /**
   * Publishes Reel to Instagram via official Media Container -> Poll Status -> Publish Container workflow.
   */
  async publishVideo({ video, metadata, account, options = {} }) {
    const igMeta = metadata?.instagram || {
      caption: `${video.title || 'বাংলা AI রিলস'}\n\n#reelsinstagram #viral #bangla`,
      hashtags: ['#reelsinstagram', '#explore', '#viral']
    };

    const validation = this.validateMetadata(igMeta);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    const cleanId = this.cleanIdentifier(account?.igUserId || account?.handle);
    const fullCaption = `${igMeta.caption}\n\n${(igMeta.hashtags || []).join(' ')}`.trim();

    if (!rawToken || !cleanId || !/^\d+$/.test(cleanId)) {
      throw new Error('Instagram Graph API access token or numeric Instagram User ID is missing. Please configure an authorized Instagram Professional account.');
    }

    // Video must be accessible via public URL for Instagram container creation
    // We construct a direct download link or public stream
    const videoUrl = `https://drive.usercontent.google.com/download?id=${video.fileId}&export=download`;

    console.log(`[Instagram Adapter] Initiating Reels upload for igUserId=${cleanId}...`);

    // Step 1: Create Media Container
    const containerRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(cleanId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: videoUrl,
        caption: fullCaption,
        share_to_feed: true,
        access_token: rawToken
      })
    });

    const containerData = await containerRes.json();
    if (!containerRes.ok || !containerData.id) {
      throw new Error(`Instagram Media Container creation failed: ${containerData.error?.message || JSON.stringify(containerData)}`);
    }

    const containerId = containerData.id;
    console.log(`[Instagram Adapter] Container created (ID: ${containerId}). Polling status...`);

    // Step 2: Poll Container Processing Status until FINISHED
    let isFinished = false;
    let pollAttempts = 0;
    const maxPollAttempts = 24; // 24 * 3s = 72s

    while (!isFinished && pollAttempts < maxPollAttempts) {
      await new Promise(r => setTimeout(r, 3000));
      pollAttempts++;

      const statusRes = await fetch(`${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${rawToken}`);
      if (statusRes.ok) {
        const sData = await statusRes.json();
        console.log(`[Instagram Adapter] Container ${containerId} status: ${sData.status_code}`);

        if (sData.status_code === 'FINISHED') {
          isFinished = true;
          break;
        } else if (sData.status_code === 'ERROR') {
          throw new Error(`Instagram container processing failed: ${sData.status || 'Encoding or aspect ratio error'}`);
        } else if (sData.status_code === 'EXPIRED') {
          throw new Error('Instagram container expired before publishing.');
        }
      }
    }

    if (!isFinished) {
      throw new Error('Instagram video processing timed out before container was ready for publishing.');
    }

    // Step 3: Publish Container
    console.log(`[Instagram Adapter] Publishing container ${containerId}...`);
    const pubRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(cleanId)}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: rawToken
      })
    });

    const pubData = await pubRes.json();
    if (!pubRes.ok || !pubData.id) {
      throw new Error(`Instagram media_publish failed: ${pubData.error?.message || JSON.stringify(pubData)}`);
    }

    const mediaId = pubData.id;

    // Step 4: Fetch Genuine Permalink
    let permalink = `https://www.instagram.com/reel/${mediaId}/`;
    try {
      const permRes = await fetch(`${GRAPH_BASE}/${mediaId}?fields=id,permalink&access_token=${rawToken}`);
      if (permRes.ok) {
        const pData = await permRes.json();
        if (pData.permalink) permalink = pData.permalink;
      }
    } catch (e) {}

    return {
      success: true,
      platform: 'instagram',
      live: true,
      status: 'published',
      postId: mediaId,
      postUrl: permalink,
      rawResponse: { containerId, mediaId, permalink },
      message: `✅ Instagram Reel সফলভাবে প্রকাশিত হয়েছে (Media ID: ${mediaId})`
    };
  }
}

module.exports = InstagramAdapter;
