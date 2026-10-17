const express = require('express');
const router = express.Router();
const geminiAi = require('../services/geminiAi');
const { getDb, updateDb, addAuditLog } = require('../database');

// Analyze video & generate structured captions with Gemini Multimodal AI
router.post('/analyze', async (req, res) => {
  const { fileId, forceRegenerate, language, style } = req.body;
  if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

  const db = getDb();
  const file = db.driveFiles?.[fileId] || { fileId, name: `Video_${fileId}.mp4` };

  try {
    const result = await geminiAi.analyzeVideoAndGenerateCaptions({
      fileId,
      fileName: file.name || file.title,
      durationSec: file.durationSec || 30,
      sizeMb: file.sizeMb || 12,
      language,
      style,
      forceRegenerate: !!forceRegenerate
    });

    if (!result.success) {
      return res.status(502).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, aiGenerated: false });
  }
});

// Test Gemini API connection & model availability
router.get('/test', async (req, res) => {
  try {
    const result = await geminiAi.testGeminiConnection();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get existing analysis
router.get('/analysis/:fileId', (req, res) => {
  const { fileId } = req.params;
  const db = getDb();
  const analysis = db.aiAnalyses?.[fileId];

  if (!analysis) {
    return res.status(404).json({ error: 'No analysis found for this file.' });
  }

  res.json({ success: true, ...analysis });
});

// Update customized captions from AI Caption Studio
router.post('/update', (req, res) => {
  const { fileId, analysis } = req.body;
  if (!fileId || !analysis) {
    return res.status(400).json({ error: 'Missing fileId or analysis' });
  }

  updateDb(draft => {
    if (!draft.aiAnalyses) draft.aiAnalyses = {};
    draft.aiAnalyses[fileId] = {
      analysis,
      updatedAt: new Date().toISOString(),
      userModified: true
    };

    // Also update any queue job that uses this fileId
    if (draft.queueJobs) {
      for (const job of draft.queueJobs) {
        if (job.fileId === fileId) {
          job.aiAnalysis = analysis;
        }
      }
    }
  });

  addAuditLog('ai', `AI ক্যাপশন কাস্টমাইজ ও আপডেট করা হয়েছে: "${fileId}"`);
  res.json({ success: true, message: 'Captions updated successfully.' });
});

module.exports = router;
