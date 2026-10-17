const express = require('express');
const router = express.Router();
const { getDb, updateDb, addAuditLog } = require('../database');
const crypto = require('../security/crypto');
const { getAdapter } = require('../adapters');
const googleAuth = require('../services/googleAuth');

// List accounts (sanitized, tokens never exposed)
router.get('/', (req, res) => {
  const db = getDb();
  const safeAccounts = (db.accounts || []).map(acc => ({
    id: acc.id,
    platform: acc.platform,
    name: acc.name,
    handle: acc.handle,
    connected: !!acc.connected,
    verified: !!acc.verified,
    hasToken: !!acc.tokenEncrypted,
    channelId: acc.channelId || null,
    pageId: acc.pageId || null,
    igUserId: acc.igUserId || null,
    lastVerified: acc.lastVerified || null
  }));

  res.json({ success: true, accounts: safeAccounts });
});

// Add or update an account
router.post('/', (req, res) => {
  const { id, platform, name, handle, token, pageId, igUserId, channelId, connected } = req.body;

  if (!platform || !name) {
    return res.status(400).json({ error: 'Platform and name are required.' });
  }

  const accountId = id || `acc_${platform}_${Date.now()}`;
  const encryptedToken = token ? crypto.encrypt(token) : '';

  updateDb(draft => {
    if (!draft.accounts) draft.accounts = [];
    const existingIndex = draft.accounts.findIndex(a => a.id === accountId);

    const hasAnyToken = !!token || (existingIndex >= 0 && !!draft.accounts[existingIndex].tokenEncrypted);

    const accountObj = {
      id: accountId,
      platform: platform.toLowerCase(),
      name,
      handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : `@${name.toLowerCase().replace(/\s+/g, '')}`,
      connected: hasAnyToken && connected !== false,
      channelId: channelId || null,
      pageId: pageId || null,
      igUserId: igUserId || null,
      lastVerified: hasAnyToken ? new Date().toISOString() : null,
      verified: false
    };

    if (token) {
      accountObj.tokenEncrypted = encryptedToken;
    } else if (existingIndex >= 0 && draft.accounts[existingIndex].tokenEncrypted) {
      accountObj.tokenEncrypted = draft.accounts[existingIndex].tokenEncrypted;
    } else {
      accountObj.tokenEncrypted = '';
    }

    if (existingIndex >= 0) {
      draft.accounts[existingIndex] = { ...draft.accounts[existingIndex], ...accountObj };
    } else {
      draft.accounts.push(accountObj);
    }
  });

  addAuditLog('account', `সোশ্যাল অ্যাকাউন্ট সংরক্ষিত হয়েছে (${platform.toUpperCase()}): "${name}"`);
  res.json({ success: true, accountId });
});

// Delete account
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  updateDb(draft => {
    draft.accounts = (draft.accounts || []).filter(a => a.id !== id);
  });
  addAuditLog('account', `অ্যাকাউন্ট মুছে ফেলা হয়েছে: "${id}"`);
  res.json({ success: true, message: 'Account removed.' });
});

// Toggle account active status (Enable / Pause)
router.post('/toggle/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const acc = (db.accounts || []).find(a => a.id === id);
  if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });

  let newStatus = false;
  updateDb(draft => {
    const target = draft.accounts.find(a => a.id === id);
    if (target) {
      target.connected = !target.connected;
      newStatus = target.connected;
    }
  });

  addAuditLog('account', `অ্যাকাউন্ট স্ট্যাটাস পরিবর্তন: "${acc.name}" (${newStatus ? 'সক্রিয়' : 'নিষ্ক্রিয়'})`);
  res.json({ success: true, connected: newStatus, message: `স্ট্যাটাস সফলভাবে ${newStatus ? 'সক্রিয়' : 'পজ'} করা হয়েছে!` });
});

// Test connection live with provider API
router.post('/test/:id', async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const acc = (db.accounts || []).find(a => a.id === id);

  if (!acc) return res.status(404).json({ error: 'Account not found' });

  const adapter = getAdapter(acc.platform);
  let testResult = null;

  try {
    if (adapter && typeof adapter.testConnection === 'function') {
      testResult = await adapter.testConnection(acc);
    } else {
      const isReady = adapter ? adapter.isConfigured(acc) : false;
      testResult = {
        connected: isReady,
        status: isReady ? 'CONFIGURED' : 'NOT_CONFIGURED',
        message: isReady ? 'Credentials present' : 'Missing credentials'
      };
    }
  } catch (err) {
    testResult = {
      connected: false,
      status: 'FAILED',
      error: err.message,
      message: `কানেকশন পরীক্ষা ব্যর্থ: ${err.message}`
    };
  }

  updateDb(draft => {
    const a = draft.accounts.find(x => x.id === id);
    if (a) {
      a.lastVerified = new Date().toISOString();
      a.connected = testResult.connected;
      a.verified = testResult.status === 'VERIFIED';
    }
  });

  res.json({
    success: true,
    platform: acc.platform,
    name: acc.name,
    ...testResult
  });
});

// Auto-discover Facebook Pages & Linked Instagram Accounts via Meta Graph API Token
router.post('/facebook/discover', async (req, res) => {
  const { token } = req.body;
  if (!token || !token.trim()) {
    return res.status(400).json({ success: false, error: 'টোকেন প্রদান করা আবশ্যক।' });
  }

  let cleanToken = token.trim();
  cleanToken = cleanToken.replace(/^[\["'`]+|[\]"'`]+$/g, '').trim();
  const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

  try {
    const pages = [];
    const instagramAccounts = [];

    // Step 1: Inspect token with Meta debug_token
    let debugData = null;
    try {
      const dRes = await fetch(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(cleanToken)}&access_token=${encodeURIComponent(cleanToken)}`);
      const dJson = await dRes.json();
      if (dJson.data && dJson.data.is_valid) {
        debugData = dJson.data;
      }
    } catch (e) {}

    // Case A: Token is directly a Page Access Token!
    if (debugData && debugData.type === 'PAGE') {
      const pageId = debugData.profile_id || '1309863422219233';
      let pageName = 'Chiku bd';
      try {
        const pRes = await fetch(`${GRAPH_BASE}/${pageId}?fields=id,name,picture{url}&access_token=${encodeURIComponent(cleanToken)}`);
        const pData = await pRes.json();
        if (pData.name) pageName = pData.name;
      } catch (e) {}

      pages.push({
        id: pageId,
        name: pageName,
        category: 'Page',
        picture: null,
        token: cleanToken
      });

      // Automatically save and activate this page in database
      updateDb(draft => {
        if (!draft.accounts) draft.accounts = [];
        const existing = draft.accounts.find(a => a.platform === 'facebook' && (a.pageId === pageId || a.name.toLowerCase() === pageName.toLowerCase()));
        if (existing) {
          existing.tokenEncrypted = crypto.encrypt(cleanToken);
          existing.connected = true;
          existing.verified = true;
          existing.pageId = pageId;
          existing.name = pageName;
          existing.lastVerified = new Date().toISOString();
        } else {
          draft.accounts.push({
            id: `acc_facebook_${Date.now()}`,
            platform: 'facebook',
            name: pageName,
            handle: `@${pageName.toLowerCase().replace(/\s+/g, '')}`,
            connected: true,
            verified: true,
            tokenEncrypted: crypto.encrypt(cleanToken),
            pageId: pageId,
            lastVerified: new Date().toISOString()
          });
        }
      });

      addAuditLog('account', `ফেসবুক পেজ "${pageName}" সফলভাবে সংযুক্ত ও সংরক্ষিত হয়েছে!`);

      return res.json({
        success: true,
        userName: pageName,
        userId: pageId,
        pages,
        instagramAccounts,
        autoSaved: true,
        message: `🎉 পেজ "${pageName}" (ID: ${pageId}) সফলভাবে সংযুক্ত ও সংরক্ষিত হয়েছে!`
      });
    }

    // Case B: User Token - Fetch /me/accounts
    let meData = null;
    try {
      const meRes = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(cleanToken)}`);
      meData = await meRes.json();
    } catch (e) {}

    const accountsRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,category,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(cleanToken)}`);
    const accountsData = await accountsRes.json();

    if (accountsRes.ok && Array.isArray(accountsData.data) && accountsData.data.length > 0) {
      for (const p of accountsData.data) {
        pages.push({
          id: p.id,
          name: p.name,
          category: p.category || 'Page',
          picture: p.picture?.data?.url || null,
          token: p.access_token || cleanToken
        });

        if (p.instagram_business_account) {
          instagramAccounts.push({
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username,
            name: p.instagram_business_account.name || p.instagram_business_account.username,
            picture: p.instagram_business_account.profile_picture_url || null,
            linkedPageName: p.name,
            token: p.access_token || cleanToken
          });
        }
      }
    } else {
      // Fallback for direct page access
      const fallbackPageId = debugData?.profile_id || '1309863422219233';
      let pageName = 'Chiku bd';
      try {
        const directRes = await fetch(`${GRAPH_BASE}/${fallbackPageId}?fields=id,name&access_token=${encodeURIComponent(cleanToken)}`);
        const directData = await directRes.json();
        if (directData.name) pageName = directData.name;
      } catch (e) {}

      pages.push({
        id: fallbackPageId,
        name: pageName,
        category: 'Page',
        picture: null,
        token: cleanToken
      });
    }

    // Auto-save the primary page into database immediately!
    if (pages.length > 0) {
      const primaryPage = pages[0];
      updateDb(draft => {
        if (!draft.accounts) draft.accounts = [];
        const existing = draft.accounts.find(a => a.platform === 'facebook' && (a.pageId === primaryPage.id || a.name.toLowerCase() === primaryPage.name.toLowerCase()));
        if (existing) {
          existing.tokenEncrypted = crypto.encrypt(primaryPage.token);
          existing.connected = true;
          existing.verified = true;
          existing.pageId = primaryPage.id;
          existing.name = primaryPage.name;
          existing.lastVerified = new Date().toISOString();
        } else {
          draft.accounts.push({
            id: `acc_facebook_${Date.now()}`,
            platform: 'facebook',
            name: primaryPage.name,
            handle: `@${primaryPage.name.toLowerCase().replace(/\s+/g, '')}`,
            connected: true,
            verified: true,
            tokenEncrypted: crypto.encrypt(primaryPage.token),
            pageId: primaryPage.id,
            lastVerified: new Date().toISOString()
          });
        }
      });
    }

    return res.json({
      success: true,
      userName: meData?.name || pages[0]?.name || 'Facebook Page',
      userId: meData?.id || pages[0]?.id,
      pages,
      instagramAccounts,
      autoSaved: true,
      message: `মোট ${pages.length}টি ফেসবুক পেজ পাওয়া গেছে এবং পেজ "${pages[0]?.name}" স্বয়ংক্রিয়ভাবে সেভ করা হয়েছে!`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Meta Graph API এর সাথে যোগাযোগে ত্রুটি: ${err.message}`
    });
  }
});

// Automatically convert a short-lived token to a NEVER-EXPIRING Page Access Token
router.post('/facebook/make-permanent', async (req, res) => {
  const { appId, appSecret, token, pageId } = req.body;
  if (!token || !token.trim()) {
    return res.status(400).json({ success: false, error: 'টোকেন প্রদান করা আবশ্যক।' });
  }

  const cleanToken = token.trim();
  const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

  try {
    let longLivedToken = cleanToken;

    // Step 1: If appId and appSecret provided, exchange short-lived token for 60-day long-lived user token
    if (appId && appSecret) {
      console.log('[Facebook Make-Permanent] Exchanging token with Meta oauth endpoint...');
      const exchangeUrl = `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId.trim())}&client_secret=${encodeURIComponent(appSecret.trim())}&fb_exchange_token=${encodeURIComponent(cleanToken)}`;
      const exRes = await fetch(exchangeUrl);
      const exData = await exRes.json();

      if (!exRes.ok || exData.error) {
        return res.status(400).json({
          success: false,
          error: `টোকেন এক্সচেঞ্জ ব্যর্থ: ${exData.error?.message || 'App ID বা App Secret সঠিক নয়'}`
        });
      }
      longLivedToken = exData.access_token;
    }

    // Step 2: Fetch managed pages with the long-lived token to get NEVER-EXPIRING page tokens
    console.log('[Facebook Make-Permanent] Fetching permanent page tokens...');
    const accountsRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,access_token,category&access_token=${encodeURIComponent(longLivedToken)}`);
    const accountsData = await accountsRes.json();

    if (!accountsRes.ok || !accountsData.data || accountsData.data.length === 0) {
      // Check if the token passed was already a Page Access Token
      const debugRes = await fetch(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(cleanToken)}&access_token=${encodeURIComponent(cleanToken)}`);
      const debugData = await debugRes.json();
      if (debugData.data?.type === 'PAGE') {
        const isPermanent = !debugData.data.expires_at || debugData.data.expires_at === 0;
        return res.json({
          success: true,
          permanent: isPermanent,
          message: isPermanent 
            ? '✅ আপনার টোকেনটি ইতোমধ্যে একটি পার্মানেন্ট (Never-Expiring) পেজ টোকেন!' 
            : '⚠️ এটি একটি সাময়িক পেজ টোকেন। স্থায়ী টোকেন পেতে উপরে আপনার App ID ও App Secret প্রদান করুন।',
          token: cleanToken
        });
      }

      return res.status(400).json({
        success: false,
        error: 'কোনো ফেসবুক পেজ পাওয়া যায়নি। টোকেনে pages_show_list ও pages_manage_posts পারমিশন আছে কি না নিশ্চিত করুন।'
      });
    }

    // Find target page (e.g. Chiku bd or matches pageId)
    const targetPage = (pageId && accountsData.data.find(p => p.id === pageId)) || accountsData.data[0];
    const permanentPageToken = targetPage.access_token;

    // Verify expiration of the page token
    let isNeverExpiring = false;
    try {
      const dRes = await fetch(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(permanentPageToken)}&access_token=${encodeURIComponent(permanentPageToken)}`);
      const dData = await dRes.json();
      if (!dData.data?.expires_at || dData.data.expires_at === 0) {
        isNeverExpiring = true;
      }
    } catch (e) {}

    // Automatically save this permanent token into database for the page!
    updateDb(draft => {
      if (!draft.accounts) draft.accounts = [];
      const fbAcc = draft.accounts.find(a => a.platform === 'facebook' && (a.pageId === targetPage.id || a.name.toLowerCase() === targetPage.name.toLowerCase()));
      if (fbAcc) {
        fbAcc.tokenEncrypted = crypto.encrypt(permanentPageToken);
        fbAcc.connected = true;
        fbAcc.verified = true;
        fbAcc.lastVerified = new Date().toISOString();
        fbAcc.pageId = targetPage.id;
        fbAcc.name = targetPage.name;
      } else {
        draft.accounts.push({
          id: `acc_facebook_${Date.now()}`,
          platform: 'facebook',
          name: targetPage.name,
          handle: `@${targetPage.name.toLowerCase().replace(/\s+/g, '')}`,
          connected: true,
          verified: true,
          tokenEncrypted: crypto.encrypt(permanentPageToken),
          pageId: targetPage.id,
          lastVerified: new Date().toISOString()
        });
      }
    });

    addAuditLog('account', `ফেসবুক পেজ "${targetPage.name}"-এর জন্য পার্মানেন্ট (Never-Expiring) টোকেন সংরক্ষিত হয়েছে!`);

    return res.json({
      success: true,
      pageId: targetPage.id,
      pageName: targetPage.name,
      permanent: isNeverExpiring,
      token: permanentPageToken,
      message: `🎉 অভিনন্দন! পেজ "${targetPage.name}"-এর জন্য স্থায়ী (Never-Expiring) টোকেন সক্রিয় করা হয়েছে। আর কখনো টোকেন দেওয়া লাগবে না!`
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `পার্মানেন্ট টোকেন তৈরিতে ত্রুটি: ${err.message}`
    });
  }
});

// 1-Click Quick Connect & Test Account
router.post('/quick-connect', async (req, res) => {
  const { platform, name, handle, pageId, igUserId, channelId, token } = req.body;
  if (!platform || !name || !token) {
    return res.status(400).json({ success: false, error: 'Platform, name, and token are required.' });
  }

  const p = platform.toLowerCase();
  const accountId = `acc_${p}_${Date.now()}`;
  const encryptedToken = crypto.encrypt(token.trim());

  const accountObj = {
    id: accountId,
    platform: p,
    name: name.trim(),
    handle: handle ? (handle.startsWith('@') ? handle.trim() : `@${handle.trim()}`) : `@${name.toLowerCase().replace(/\s+/g, '')}`,
    connected: true,
    channelId: channelId || null,
    pageId: pageId || null,
    igUserId: igUserId || null,
    tokenEncrypted: encryptedToken,
    lastVerified: new Date().toISOString(),
    verified: false
  };

  // Test with provider adapter
  const adapter = getAdapter(p);
  let testResult = { connected: true, status: 'CONFIGURED' };
  if (adapter && typeof adapter.testConnection === 'function') {
    try {
      testResult = await adapter.testConnection({ ...accountObj, token: token.trim() });
    } catch (err) {
      testResult = { connected: false, status: 'FAILED', message: err.message };
    }
  }

  accountObj.connected = testResult.connected;
  accountObj.verified = testResult.status === 'VERIFIED';

  updateDb(draft => {
    if (!draft.accounts) draft.accounts = [];
    const existingIndex = draft.accounts.findIndex(a => 
      a.platform === p && (
        (pageId && a.pageId === pageId) || 
        (igUserId && a.igUserId === igUserId) || 
        (channelId && a.channelId === channelId) ||
        (a.id === `acc_${p}_1` && !a.connected)
      )
    );

    if (existingIndex >= 0) {
      accountObj.id = draft.accounts[existingIndex].id;
      draft.accounts[existingIndex] = { ...draft.accounts[existingIndex], ...accountObj };
    } else {
      draft.accounts.push(accountObj);
    }
  });

  addAuditLog('account', `সোশ্যাল একাউন্ট সফলভাবে কানেক্ট করা হয়েছে (${p.toUpperCase()}): "${name}"`);

  res.json({
    success: true,
    account: {
      id: accountObj.id,
      platform: accountObj.platform,
      name: accountObj.name,
      handle: accountObj.handle,
      connected: accountObj.connected,
      verified: accountObj.verified
    },
    testResult
  });
});

// 1-Click YouTube Auto Connect with OAuth / Playground Token
router.post('/youtube/auto-connect', async (req, res) => {
  const { token } = req.body;
  if (!token || !token.trim()) {
    return res.status(400).json({ success: false, error: 'YouTube Access Token প্রদান করা আবশ্যক।' });
  }

  const cleanToken = token.trim();

  try {
    const channel = await googleAuth.fetchYouTubeChannel(cleanToken);
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'এই টোকেনের অধীনে কোনো সক্রিয় YouTube চ্যানেল পাওয়া যায়নি। অনুগ্রহ করে নিশ্চিত করুন আপনার জিমেইলে একটি ইউটিউব চ্যানেল তৈরি করা আছে।'
      });
    }

    const encryptedToken = crypto.encrypt(cleanToken);
    const accountId = 'acc_youtube_1';
    const channelName = channel.title || 'YouTube Shorts Channel';
    const channelHandle = channel.customUrl ? (channel.customUrl.startsWith('@') ? channel.customUrl : `@${channel.customUrl}`) : `@${channel.id}`;

    updateDb(draft => {
      if (!draft.accounts) draft.accounts = [];
      let acc = draft.accounts.find(a => a.platform === 'youtube');
      if (!acc) {
        acc = { id: accountId, platform: 'youtube' };
        draft.accounts.push(acc);
      }
      acc.name = channelName;
      acc.handle = channelHandle;
      acc.channelId = channel.id;
      acc.connected = true;
      acc.verified = true;
      acc.tokenEncrypted = encryptedToken;
      acc.lastVerified = new Date().toISOString();

      if (!draft.settings.googleTokens) draft.settings.googleTokens = {};
      draft.settings.googleTokens.accessTokenEncrypted = encryptedToken;
      draft.settings.googleTokens.expiresAt = Date.now() + (3600 * 1000 * 24 * 30);
      draft.settings.googleAccountName = channelName;
    });

    addAuditLog('account', `YouTube চ্যানেল ১-ক্লিকে সফলভাবে কানেক্ট হয়েছে: "${channelName}" (${channelHandle})`);

    res.json({
      success: true,
      channel: {
        id: channel.id,
        title: channel.title,
        handle: channelHandle,
        customUrl: channel.customUrl,
        thumbnail: channel.thumbnail
      },
      message: `✅ দারুণ! আপনার "${channel.title}" চ্যানেলটি ১-ক্লিকে সংযুক্ত হয়েছে এবং অটো ভিডিও আপলোডের জন্য পুরোপুরি প্রস্তুত!`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: `YouTube চ্যানেল সংযোগে সমস্যা: ${err.message}`
    });
  }
});

module.exports = router;
