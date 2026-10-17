const BaseAdapter = require('./baseAdapter');
const crypto = require('../security/crypto');

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

class TikTokAdapter extends BaseAdapter {
  constructor() {
    super('tiktok');
  }

  isConfigured(account) {
    const hasToken = !!(account?.tokenEncrypted || account?.token);
    return !!(account && account.connected && hasToken);
  }

  validateMetadata(metadata) {
    const caption = metadata?.caption || '';
    if (!caption.trim()) {
      return { valid: false, error: 'TikTok caption cannot be empty.' };
    }
    if (caption.length > 2200) {
      return { valid: false, error: `TikTok caption exceeds 2200 characters limit (${caption.length}).` };
    }
    return { valid: true };
  }

  /**
   * Tests TikTok API token, creator eligibility, and audit approval status.
   */
  async testConnection(account) {
    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    if (!rawToken) {
      return {
        connected: false,
        status: 'NOT_CONFIGURED',
        message: 'TikTok Content Posting API access token অনুপস্থিত। Social Accounts-এ টোকেন দিন।'
      };
    }

    try {
      // Query creator info to verify token & creator capabilities
      const res = await fetch(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${rawToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      const data = await res.json();
      if (!res.ok || data.error?.code !== 'ok') {
        const errMsg = data.error?.message || `HTTP ${res.status}`;
        const errCode = data.error?.code;

        if (errCode === 'scope_not_authorized' || errCode === 'access_token_invalid') {
          return {
            connected: false,
            status: 'SCOPE_OR_AUDIT_REQUIRED',
            code: errCode,
            message: `TikTok API এক্সেস সীমাবদ্ধ: ${errMsg}. অ্যাপটিতে "video.publish" বা "video.upload" স্কোপ এবং TikTok Developer Audit অনুমোদন থাকা আবশ্যক।`
          };
        }

        return {
          connected: false,
          status: 'FAILED',
          code: errCode,
          message: `TikTok API যাচাই ব্যর্থ: ${errMsg}`
        };
      }

      const creator = data.data || {};
      return {
        connected: true,
        status: 'VERIFIED',
        creatorNickname: creator.creator_nickname,
        creatorUsername: creator.creator_username,
        privacyOptions: creator.privacy_level_options,
        maxDurationSec: creator.max_video_post_duration_sec,
        message: `✅ TikTok Creator API যাচাই সম্পন্ন! ক্রিয়েটর: "${creator.creator_nickname || creator.creator_username}" (সর্বোচ্চ দৈর্ঘ্য: ${creator.max_video_post_duration_sec}s)`
      };
    } catch (err) {
      return {
        connected: false,
        status: 'FAILED',
        error: err.message,
        message: `TikTok কানেকশন যাচাইয়ে ত্রুটি: ${err.message}`
      };
    }
  }

  /**
   * Publishes video to TikTok via official Content Posting API v2.
   */
  async publishVideo({ video, metadata, account, options = {} }) {
    const ttMeta = metadata?.tiktok || {
      caption: `${video.title || 'বাংলা AI ভাইরাল রিলস'} #fyp #viral #bangla`,
      hashtags: ['#fyp', '#viral']
    };

    const validation = this.validateMetadata(ttMeta);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const rawToken = account?.tokenEncrypted ? crypto.decrypt(account.tokenEncrypted) : (account?.token || '');
    if (!rawToken) {
      throw new Error('TikTok Content Posting API access token is missing. Direct publishing requires official API authorization and TikTok developer approval.');
    }

    const fullCaption = `${ttMeta.caption}\n\n${(ttMeta.hashtags || []).join(' ')}`.trim();
    const isDirectPost = options.directPost !== false;
    const endpoint = isDirectPost
      ? `${TIKTOK_API_BASE}/post/publish/video/init/`
      : `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`;

    const videoUrl = `https://drive.usercontent.google.com/download?id=${video.fileId}&export=download`;

    console.log(`[TikTok Adapter] Initializing TikTok ${isDirectPost ? 'Direct Post' : 'Draft Upload'}...`);

    const postPayload = {
      post_info: {
        title: fullCaption,
        privacy_level: options.privacy || 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_stitch: false,
        disable_comment: false
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl
      }
    };

    const initRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${rawToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify(postPayload)
    });

    const initData = await initRes.json();
    if (!initRes.ok || initData.error?.code !== 'ok' || !initData.data?.publish_id) {
      const errMsg = initData.error?.message || JSON.stringify(initData);
      throw new Error(`TikTok Content Posting API init failed: ${errMsg}`);
    }

    const publishId = initData.data.publish_id;
    console.log(`[TikTok Adapter] Upload accepted (Publish ID: ${publishId}). Polling status...`);

    // Poll publish status
    let publishStatus = 'PROCESSING_DOWNLOAD';
    let pollAttempts = 0;
    const maxPoll = 15;

    while (publishStatus.startsWith('PROCESSING') && pollAttempts < maxPoll) {
      await new Promise(r => setTimeout(r, 3000));
      pollAttempts++;

      try {
        const stRes = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${rawToken}`,
            'Content-Type': 'application/json; charset=UTF-8'
          },
          body: JSON.stringify({ publish_id: publishId })
        });

        const stData = await stRes.json();
        if (stData.data?.status) {
          publishStatus = stData.data.status;
          console.log(`[TikTok Adapter] Publish ID ${publishId} status: ${publishStatus}`);
          if (publishStatus === 'SUCCESS') break;
          if (publishStatus === 'FAILED') {
            throw new Error(`TikTok server rejected post: ${stData.data.fail_reason || 'Processing failed'}`);
          }
        }
      } catch (pollErr) {
        if (pollErr.message.includes('rejected')) throw pollErr;
      }
    }

    const cleanHandle = (account?.handle || 'tiktok').replace(/^@/, '');
    const isPublicSuccess = publishStatus === 'SUCCESS';

    return {
      success: true,
      platform: 'tiktok',
      live: isPublicSuccess,
      isDraft: !isDirectPost,
      publishStatus,
      publishId,
      postId: publishId,
      postUrl: `https://www.tiktok.com/@${cleanHandle}`,
      rawResponse: { publishId, status: publishStatus },
      message: isPublicSuccess
        ? `✅ TikTok ভিডিও সফলভাবে প্রকাশিত হয়েছে (Publish ID: ${publishId})`
        : `ℹ️ TikTok ভিডিও প্রসেসিংয়ে জমা হয়েছে (${publishStatus}, Publish ID: ${publishId})`
    };
  }
}

module.exports = TikTokAdapter;
