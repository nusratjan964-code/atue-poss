const express = require('express');
const router = express.Router();
const scheduler = require('../services/scheduler');
const { getDb, updateDb, addAuditLog } = require('../database');

// List queue jobs
router.get('/', (req, res) => {
  const db = getDb();
  const jobs = db.queueJobs || [];
  const publishedToday = scheduler.getPublishedCountToday();
  const dailyLimit = db.settings.dailyLimit || 3;

  res.json({
    success: true,
    publishedToday,
    dailyLimit,
    remainingToday: Math.max(0, dailyLimit - publishedToday),
    jobs
  });
});

// Trigger a scheduler tick manually
router.post('/trigger-tick', async (req, res) => {
  try {
    const result = await scheduler.processSchedulerTick();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.post('/tick', async (req, res) => {
  try {
    const result = await scheduler.processSchedulerTick();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve and publish a job (Review Mode approval)
router.post('/approve/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { customMetadata } = req.body;

  try {
    const result = await scheduler.approveAndPublishJob(jobId, customMetadata);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Retry a failed job
router.post('/retry/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const db = getDb();
  const job = (db.queueJobs || []).find(j => j.id === jobId);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  updateDb(draft => {
    const j = draft.queueJobs.find(x => x.id === jobId);
    if (j) {
      j.status = 'analyzing';
      j.retryCount = (j.retryCount || 0) + 1;
      delete j.error;
    }
  });

  try {
    const result = await scheduler.publishJobToPlatforms(jobId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete / Cancel a job
router.delete('/:jobId', (req, res) => {
  const { jobId } = req.params;
  updateDb(draft => {
    draft.queueJobs = (draft.queueJobs || []).filter(j => j.id !== jobId);
  });
  addAuditLog('scheduler', `কিউ জব বাতিল করা হয়েছে: "${jobId}"`);
  res.json({ success: true, message: 'Job removed.' });
});

module.exports = router;
