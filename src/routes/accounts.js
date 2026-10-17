const express = require('express');
const router = express.Router();
const { getDb, updateDb, addAuditLog } = require('../database');
const crypto = require('../security/crypto');
const { getAdapter } = require('../adapters');

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

module.exports = router;
