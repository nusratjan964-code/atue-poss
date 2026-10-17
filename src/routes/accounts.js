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

  const cleanToken = token.trim();
  const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

  try {
    // 1. Fetch user or page identity
    const meRes = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${cleanToken}`);
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      return res.status(400).json({
        success: false,
        error: meData.error?.message || 'টোকেনটি অবৈধ বা মেয়াদোত্তীর্ণ। নতুন টোকেন তৈরি করুন।',
        type: meData.error?.type
      });
    }

    // 2. Fetch managed pages with Instagram business account details
    const accountsRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,category,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}&access_token=${cleanToken}`);
    const accountsData = await accountsRes.json();

    const pages = [];
    const instagramAccounts = [];

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
      // If token provided is directly a Page Access Token
      pages.push({
        id: meData.id,
        name: meData.name,
        category: 'Page',
        picture: null,
        token: cleanToken
      });

      try {
        const igRes = await fetch(`${GRAPH_BASE}/${meData.id}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${cleanToken}`);
        const igData = await igRes.json();
        if (igRes.ok && igData.instagram_business_account) {
          instagramAccounts.push({
            id: igData.instagram_business_account.id,
            username: igData.instagram_business_account.username,
            name: igData.instagram_business_account.name || igData.instagram_business_account.username,
            picture: igData.instagram_business_account.profile_picture_url || null,
            linkedPageName: meData.name,
            token: cleanToken
          });
        }
      } catch (e) {}
    }

    return res.json({
      success: true,
      userName: meData.name,
      userId: meData.id,
      pages,
      instagramAccounts,
      message: `মোট ${pages.length}টি ফেসবুক পেজ এবং ${instagramAccounts.length}টি ইনস্টাগ্রাম একাউন্ট পাওয়া গেছে!`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Meta Graph API এর সাথে যোগাযোগে ত্রুটি: ${err.message}`
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
