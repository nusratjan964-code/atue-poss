const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb, updateDb, addAuditLog } = require('../database');
const costTracker = require('./costTracker');
const googleDrive = require('./googleDrive');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

/**
 * Validates and normalizes structured caption output.
 */
function validateStructuredCaption(parsed, language = 'bn') {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not a valid JSON object');
  }

  const valid = {
    summary: parsed.summary || 'ভিডিওটির বিষয়বস্তু বিশ্লেষণ সম্পন্ন হয়েছে।',
    mainTopic: parsed.mainTopic || 'AI Shorts & Reels',
    category: parsed.category || 'Entertainment',
    openingHook: parsed.openingHook || 'ভিডিওটি দেখে আপনার মন্তব্য জানান!',
    detectedLanguage: parsed.detectedLanguage || language,
    explanation: parsed.explanation || 'ভিডিওর প্রধান আকর্ষণ এবং দর্শকদের আগ্রহ বৃদ্ধির ওপর ভিত্তি করে তৈরি।',
    contentWarnings: parsed.contentWarnings || 'None',
    youtube: {
      title: parsed.youtube?.title || `${parsed.mainTopic || 'নতুন ভিডিও'} #Shorts`,
      description: parsed.youtube?.description || `${parsed.summary || ''}\n\n#Shorts #BanglaAI #Trending`,
      tags: Array.isArray(parsed.youtube?.tags) ? parsed.youtube.tags : ['#Shorts', '#Viral', '#BanglaAI']
    },
    facebook: {
      caption: parsed.facebook?.caption || `${parsed.openingHook || ''}\n\n${parsed.summary || ''}`,
      hashtags: Array.isArray(parsed.facebook?.hashtags) ? parsed.facebook.hashtags : ['#Reels', '#ViralReels', '#FBReels']
    },
    instagram: {
      caption: parsed.instagram?.caption || `${parsed.openingHook || ''}\n\n${parsed.summary || ''}`,
      hashtags: Array.isArray(parsed.instagram?.hashtags) ? parsed.instagram.hashtags : ['#reelsinstagram', '#explore', '#viral']
    },
    tiktok: {
      caption: parsed.tiktok?.caption || `${parsed.openingHook || ''} #TikTokReels #Viral`,
      hashtags: Array.isArray(parsed.tiktok?.hashtags) ? parsed.tiktok.hashtags : ['#TikTok', '#fyp', '#viral']
    }
  };

  // Enforce platform constraints
  if (valid.youtube.title.length > 100) {
    valid.youtube.title = valid.youtube.title.slice(0, 97) + '...';
  }
  if (valid.instagram.hashtags.length > 30) {
    valid.instagram.hashtags = valid.instagram.hashtags.slice(0, 30);
  }

  return valid;
}

/**
 * Offline Heuristic Template generator for manual draft use only.
 * Explicitly marked with aiGenerated = false.
 */
function generateHeuristicCaptions(videoMeta = {}, language = 'bn', style = 'entertaining') {
  const title = (videoMeta.name || videoMeta.title || 'বাংলা AI ভাইরাল ভিডিও')
    .replace(/\.(mp4|mov|mkv|webm)$/i, '')
    .replace(/^masstiktok_[a-zA-Z0-9]+_+/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  let hook = 'এটা কি আপনি আগে জানতেন? শেষ পর্যন্ত দেখুন!';
  let summary = `এই ভিডিওটিতে ${title}-এর একটি আকর্ষণীয় দৃশ্য তুলে ধরা হয়েছে।`;
  let ytTitle = `${title} 🚀 #Shorts #BanglaAI`;
  let fbCaption = `🔥 ${hook}\n\n${summary}\n\nভিডিওটি ভালো লাগলে লাইক ও শেয়ার করতে ভুলবেন না! ❤️`;
  let igCaption = `✨ ${title}\n\n${hook}\n\nভিডিওটি সেভ করে রাখুন এবং বন্ধুদের সাথে শেয়ার করুন! 📌`;
  let ttCaption = `👀 ${hook} — ${title} #fyp #viral #bangla`;

  if (language === 'en') {
    hook = 'Wait until the very end! You won’t believe this.';
    summary = `Exploring the incredible story of ${title}.`;
    ytTitle = `${title} — Must Watch! #Shorts #Viral`;
    fbCaption = `🔥 ${hook}\n\n${summary}\n\nLike and share if you found this interesting!`;
    igCaption = `✨ ${title}\n\n${hook}\n\nSave for later and tag a friend! 📌`;
    ttCaption = `👀 ${hook} #fyp #viral #trending`;
  } else if (language === 'banglish') {
    hook = 'Eita ki apni age janten? Sesh porjonto dekhun!';
    summary = `${title} niye ekta osadharon video.`;
    ytTitle = `${title} — Dekhun Ki Ghote! #Shorts`;
    fbCaption = `🔥 ${hook}\n\n${summary}\n\nBhalo lagle oboshyoi share korben! ❤️`;
    igCaption = `✨ ${title}\n\n${hook}\n\nTag your friends! 📌`;
    ttCaption = `👀 ${hook} #fyp #bangla #viral`;
  }

  return {
    aiGenerated: false,
    summary,
    mainTopic: title,
    category: 'Entertainment',
    openingHook: hook,
    detectedLanguage: language,
    explanation: 'Manual/offline heuristic draft. Not analyzed by Gemini multimodal AI.',
    contentWarnings: 'None',
    youtube: {
      title: ytTitle.slice(0, 99),
      description: `${fbCaption}\n\n#Shorts #BanglaAI #Trending #ViralShorts`,
      tags: ['#Shorts', '#Viral', '#BanglaAI', '#Trending']
    },
    facebook: {
      caption: fbCaption,
      hashtags: ['#FacebookReels', '#BanglaReels', '#Viral', '#Trending']
    },
    instagram: {
      caption: igCaption,
      hashtags: ['#reelsinstagram', '#explorepage', '#viralreels', '#bangla']
    },
    tiktok: {
      caption: ttCaption,
      hashtags: ['#tiktok', '#fyp', '#viral', '#bangla']
    }
  };
}

/**
 * Uploads a video file to Google Generative Language Files API.
 */
async function uploadVideoToGeminiFilesApi(filePath, mimeType, displayName, apiKey) {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;

  // Step 1: Initialize Resumable Upload
  const initRes = await fetch(`${GEMINI_UPLOAD_BASE}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(fileSize),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file: { display_name: displayName }
    })
  });

  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!initRes.ok || !uploadUrl) {
    const errText = await initRes.text().catch(() => '');
    throw new Error(`Failed to initialize Gemini File Upload: HTTP ${initRes.status} ${errText}`);
  }

  // Step 2: Upload File Content Bytes
  const fileBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(fileSize),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fileBuffer
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Gemini File Content upload failed: HTTP ${uploadRes.status} ${errText}`);
  }

  const fileData = await uploadRes.json();
  const fileResource = fileData.file;

  // Step 3: Poll File state until ACTIVE
  let fileState = fileResource.state;
  let attempts = 0;
  while (fileState === 'PROCESSING' && attempts < 20) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    const statusRes = await fetch(`${GEMINI_API_BASE}/${fileResource.name}?key=${apiKey}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      fileState = statusData.state;
    }
  }

  if (fileState === 'FAILED') {
    throw new Error('Gemini video processing state returned FAILED.');
  }

  return fileResource;
}

/**
 * Deletes an uploaded file from Gemini storage after processing.
 */
async function deleteGeminiFile(fileName, apiKey) {
  try {
    await fetch(`${GEMINI_API_BASE}/${fileName}?key=${apiKey}`, {
      method: 'DELETE'
    });
  } catch (e) {
    console.warn(`[GeminiAI] Failed to delete temporary file ${fileName}:`, e.message);
  }
}

/**
 * Primary Video Analysis function using multimodal Gemini API.
 */
async function analyzeVideoAndGenerateCaptions({
  fileId,
  fileName,
  durationSec = 30,
  sizeMb = 10,
  language = null,
  style = null,
  forceRegenerate = false
}) {
  const db = getDb();
  const selectedLang = language || db.settings.preferredLanguage || 'bn';
  const selectedStyle = style || db.settings.captionStyle || 'entertaining';
  const modelName = db.settings.geminiModel || config.GEMINI_MODEL || 'gemini-2.5-flash';

  // 1. Check cache
  if (!forceRegenerate && db.aiAnalyses?.[fileId]?.aiGenerated) {
    const cached = db.aiAnalyses[fileId];
    return {
      success: true,
      cached: true,
      aiGenerated: true,
      model: cached.model || modelName,
      analysis: cached.analysis
    };
  }

  // 2. Verify API Key
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    const manualDraft = generateHeuristicCaptions({ name: fileName }, selectedLang, selectedStyle);
    return {
      success: false,
      aiGenerated: false,
      error: 'GEMINI_API_KEY is not configured in .env. Please provide a valid Gemini API key to run real multimodal video analysis.',
      model: 'none',
      manualFallbackDraft: manualDraft
    };
  }

  // 3. Verify Quota
  if (!costTracker.canMakeGeminiRequest()) {
    return {
      success: false,
      aiGenerated: false,
      quotaReached: true,
      error: 'Daily Gemini AI request limit reached. Increase limit in Settings or wait for tomorrow.'
    };
  }

  let tempVideoPath = null;
  let geminiUploadedFile = null;

  try {
    console.log(`[GeminiAI] Preparing video "${fileName}" (${fileId}) for multimodal analysis with ${modelName}...`);

    // Download video bytes for multimodal analysis
    try {
      const dl = await googleDrive.downloadVideoToTempFile(fileId);
      tempVideoPath = dl.filePath;
    } catch (dlErr) {
      console.warn(`[GeminiAI] Video download failed: ${dlErr.message}. Checking direct stream...`);
    }

    const promptText = `You are an expert social media video strategist, editor, and viral copywriter.
Inspect this video carefully (analyze the visual scenes, on-screen text, pacing, mood, and any audio/voice context).

Video details:
- File Name: "${fileName}"
- Target Language: ${selectedLang} (bn = Bengali, en = English, banglish = Bengali in English letters)
- Tone / Style: ${selectedStyle} (entertaining, educational, storytelling, professional, promotional)

Return ONLY valid JSON with this exact structure:
{
  "summary": "Concise 2-3 sentence summary explaining what actually happens in the video",
  "mainTopic": "Primary topic, recipe, event, or character seen in video",
  "category": "Food / Entertainment / Tech / Education / Lifestyle",
  "openingHook": "High-retention 1-line hook directly referencing the visual action in the first 3 seconds",
  "detectedLanguage": "${selectedLang}",
  "explanation": "Why this hook and title will drive high viewer retention based on the actual video visual contents",
  "contentWarnings": "None or specific warning",
  "youtube": {
    "title": "Shorts title strictly under 95 characters including 1-2 relevant hashtags",
    "description": "Engaging description with summary, visual hook, call to action, and 4-5 relevant hashtags",
    "tags": ["#Shorts", "#Viral", "#BanglaAI"]
  },
  "facebook": {
    "caption": "Facebook Reels caption with strong hook, question for engagement, and 3-4 hashtags",
    "hashtags": ["#FacebookReels", "#BanglaReels", "#Viral"]
  },
  "instagram": {
    "caption": "Instagram Reels caption with emojis, engaging hook, and relevant hashtags (max 20 hashtags)",
    "hashtags": ["#reelsinstagram", "#explorepage", "#viralreels"]
  },
  "tiktok": {
    "caption": "Punchy TikTok caption strictly under 150 characters with 3 hashtags",
    "hashtags": ["#fyp", "#viral", "#foryou"]
  }
}`;

    const parts = [];

    // Attach multimodal video data if file was downloaded
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      const stats = fs.statSync(tempVideoPath);
      if (stats.size > 0 && stats.size <= 20 * 1024 * 1024) {
        // Under 20MB: Use inlineData
        const base64Data = fs.readFileSync(tempVideoPath).toString('base64');
        parts.push({
          inline_data: {
            mime_type: 'video/mp4',
            data: base64Data
          }
        });
      } else if (stats.size > 20 * 1024 * 1024) {
        // Over 20MB: Use Files API
        geminiUploadedFile = await uploadVideoToGeminiFilesApi(tempVideoPath, 'video/mp4', fileName, apiKey);
        parts.push({
          file_data: {
            mime_type: geminiUploadedFile.mimeType || 'video/mp4',
            file_uri: geminiUploadedFile.uri
          }
        });
      }
    }

    parts.push({ text: promptText });

    const apiUrl = `${GEMINI_API_BASE}/models/${modelName}:generateContent?key=${apiKey}`;
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.4,
          max_output_tokens: 2000
        }
      })
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.json().catch(() => ({}));
      throw new Error(`Gemini API Error (HTTP ${apiRes.status}): ${errBody.error?.message || apiRes.statusText}`);
    }

    const geminiJson = await apiRes.json();
    const candidateText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Gemini API returned an empty response candidate.');
    }

    const usageMeta = geminiJson.usageMetadata || {};
    costTracker.recordGeminiUsage({
      inputTokens: usageMeta.promptTokenCount || 500,
      outputTokens: usageMeta.candidatesTokenCount || 700
    });

    const cleanJsonStr = candidateText.replace(/^```json/i, '').replace(/```$/i, '').trim();
    const parsedObj = JSON.parse(cleanJsonStr);
    const validated = validateStructuredCaption(parsedObj, selectedLang);
    validated.aiGenerated = true;

    // Cache in DB
    updateDb(draft => {
      if (!draft.aiAnalyses) draft.aiAnalyses = {};
      draft.aiAnalyses[fileId] = {
        analysis: validated,
        generatedAt: new Date().toISOString(),
        model: modelName,
        aiGenerated: true,
        multimodal: parts.length > 1,
        tokens: usageMeta
      };
    });

    addAuditLog('ai', `Gemini (${modelName}) দ্বারা সফলভাবে মাল্টিমোডাল ভিডিও বিশ্লেষণ ও ক্যাপশন তৈরি হয়েছে: "${fileName}"`);

    return {
      success: true,
      aiGenerated: true,
      model: modelName,
      multimodal: parts.length > 1,
      analysis: validated
    };
  } catch (err) {
    console.error('[GeminiAI] Live Multimodal Analysis failed:', err.message);
    addAuditLog('error', `Gemini বিশ্লেষণ ব্যর্থ: ${err.message}`);

    const manualFallback = generateHeuristicCaptions({ name: fileName }, selectedLang, selectedStyle);
    return {
      success: false,
      aiGenerated: false,
      error: err.message,
      model: modelName,
      manualFallbackDraft: manualFallback
    };
  } finally {
    // Clean up temporary local file
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
    }
    // Clean up temporary Gemini uploaded file
    if (geminiUploadedFile && apiKey) {
      deleteGeminiFile(geminiUploadedFile.name, apiKey);
    }
  }
}

/**
 * Health check test for Gemini API Key and configured model.
 */
async function testGeminiConnection() {
  const apiKey = config.GEMINI_API_KEY;
  const modelName = config.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey) {
    return {
      connected: false,
      status: 'NOT_CONFIGURED',
      model: modelName,
      message: 'GEMINI_API_KEY কনফিগার করা নেই। .env ফাইলে আপনার Gemini API কী দিন।'
    };
  }

  const startTime = Date.now();
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'Respond with exactly: {"status":"active","ping":"pong"}' }]
        }],
        generationConfig: {
          response_mime_type: 'application/json',
          max_output_tokens: 50
        }
      })
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        connected: false,
        status: 'FAILED',
        model: modelName,
        latencyMs,
        error: err.error?.message || `HTTP ${res.status}`
      };
    }

    const data = await res.json();
    return {
      connected: true,
      status: 'VERIFIED',
      model: modelName,
      latencyMs,
      message: `✅ Gemini Multimodal API (${modelName}) সক্রিয় এবং সফলভাবে সংযুক্ত! (Latency: ${latencyMs}ms)`
    };
  } catch (err) {
    return {
      connected: false,
      status: 'FAILED',
      model: modelName,
      error: err.message
    };
  }
}

module.exports = {
  analyzeVideoAndGenerateCaptions,
  generateHeuristicCaptions,
  validateStructuredCaption,
  testGeminiConnection
};
