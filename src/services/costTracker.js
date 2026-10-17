const { getDb, updateDb } = require('../database');

/**
 * Get date string in the target timezone (e.g. 'YYYY-MM-DD').
 * @param {string} timezone Target IANA timezone
 * @param {Date|string} date Date object or ISO string (defaults to now)
 */
function getLocalDateString(timezone = 'Asia/Dhaka', date = new Date()) {
  try {
    const d = (date instanceof Date) ? date : new Date(date);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d);
  } catch (e) {
    return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  }
}

/**
 * Check if daily Gemini usage is within allowed limits.
 */
function canMakeGeminiRequest() {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  const today = getLocalDateString(tz);
  const limit = db.settings.dailyGeminiLimit || 50;

  const usageToday = db.geminiUsage?.dates?.[today]?.requests || 0;
  return usageToday < limit;
}

/**
 * Record usage from a Gemini API call.
 */
function recordGeminiUsage({ inputTokens = 0, outputTokens = 0 } = {}) {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  const today = getLocalDateString(tz);

  // Gemini 1.5/2.5 Flash pricing estimations:
  // Input: ~$0.075 per 1,000,000 tokens ($0.000000075 / token)
  // Output: ~$0.30 per 1,000,000 tokens ($0.00000030 / token)
  const inputCost = (inputTokens / 1_000_000) * 0.075;
  const outputCost = (outputTokens / 1_000_000) * 0.30;
  const callCost = inputCost + outputCost;

  updateDb(draft => {
    if (!draft.geminiUsage) draft.geminiUsage = { dates: {} };
    if (!draft.geminiUsage.dates) draft.geminiUsage.dates = {};
    if (!draft.geminiUsage.dates[today]) {
      draft.geminiUsage.dates[today] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0
      };
    }

    const current = draft.geminiUsage.dates[today];
    current.requests += 1;
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.estimatedCostUsd += callCost;
  });
}

/**
 * Get aggregated cost and usage stats.
 */
function getCostStats() {
  const db = getDb();
  const tz = db.settings.timezone || 'Asia/Dhaka';
  const today = getLocalDateString(tz);
  const limit = db.settings.dailyGeminiLimit || 50;

  const todayStats = db.geminiUsage?.dates?.[today] || {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0
  };

  let totalRequests = 0;
  let totalCost = 0;
  if (db.geminiUsage?.dates) {
    for (const d of Object.values(db.geminiUsage.dates)) {
      totalRequests += d.requests || 0;
      totalCost += d.estimatedCostUsd || 0;
    }
  }

  return {
    todayDate: today,
    timezone: tz,
    todayRequests: todayStats.requests,
    dailyLimit: limit,
    remainingRequestsToday: Math.max(0, limit - todayStats.requests),
    todayEstimatedCost: todayStats.estimatedCostUsd.toFixed(4),
    totalRequests,
    totalEstimatedCost: totalCost.toFixed(4),
    freeTierNotice: 'Gemini Flash tier provides free quota (up to 15 RPM / 1M TPM). Billed pricing applies only beyond free quota.'
  };
}

module.exports = {
  getLocalDateString,
  canMakeGeminiRequest,
  recordGeminiUsage,
  getCostStats
};
