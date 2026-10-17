const assert = require('assert');
const { validateStructuredCaption, generateHeuristicCaptions } = require('../src/services/geminiAi');

function runGeminiTests() {
  console.log('--- Testing Gemini AI Structured Metadata & Fallback ---');

  // Test 1: validateStructuredCaption normalizes and fills missing fields
  const mockRawGeminiJson = {
    summary: 'A fast-paced Bangla tech review showing smartphones.',
    mainTopic: 'Bangla Tech Review',
    category: 'Technology',
    openingHook: '১ মিনিটের মধ্যে সেরা ফোন কোনটা জানুন!',
    youtube: {
      title: 'সেরা ৫টি স্মার্টফোন ২০২৩ #Shorts'
    },
    facebook: {
      caption: 'সেরা বাজেট ফোন সম্পর্কে বিস্তারিত জানুন।'
    }
  };

  const validated = validateStructuredCaption(mockRawGeminiJson, 'bn');
  assert.strictEqual(validated.summary, mockRawGeminiJson.summary);
  assert.strictEqual(validated.mainTopic, mockRawGeminiJson.mainTopic);
  assert.strictEqual(validated.youtube.title, mockRawGeminiJson.youtube.title);
  assert(validated.youtube.tags.length > 0, 'Tags should be populated with default array if missing');
  assert(validated.instagram.caption, 'Instagram caption should be auto-derived');
  assert(validated.tiktok.caption, 'TikTok caption should be auto-derived');
  console.log('  [PASS] validateStructuredCaption correctly validates and auto-fills missing platforms');

  // Test 2: Character limit clipping (YouTube title <= 100)
  const longTitleObj = {
    summary: 'test',
    youtube: {
      title: 'X'.repeat(150)
    }
  };
  const clipped = validateStructuredCaption(longTitleObj, 'en');
  assert(clipped.youtube.title.length <= 100, 'YouTube title must be truncated to <= 100 characters');
  assert(clipped.youtube.title.endsWith('...'), 'Truncated title should end with ellipsis');
  console.log('  [PASS] YouTube title strictly adheres to <= 100 character limit');

  // Test 3: Heuristic generator for Bangla, English, Banglish
  const bnMeta = generateHeuristicCaptions({ name: 'funny_cats_video.mp4' }, 'bn', 'entertaining');
  assert(bnMeta.summary, 'Bangla summary should exist');
  assert(bnMeta.youtube.title.includes('#Shorts'), 'YouTube title should have #Shorts');
  assert(bnMeta.facebook.caption, 'Facebook caption should exist');

  const enMeta = generateHeuristicCaptions({ name: 'tech_tutorial_react.mp4' }, 'en', 'educational');
  assert(enMeta.detectedLanguage === 'en', 'English language correctly identified');

  const bngMeta = generateHeuristicCaptions({ name: 'vlog_dhaka_city.mp4' }, 'banglish', 'storytelling');
  assert(bngMeta.detectedLanguage === 'banglish', 'Banglish language correctly identified');
  console.log('  [PASS] Heuristic caption fallback supports Bangla, English, and Banglish styles');
}

module.exports = runGeminiTests;

if (require.main === module) {
  try {
    runGeminiTests();
    console.log('All Gemini AI tests passed!\n');
  } catch (err) {
    console.error('Gemini AI test failed:', err);
    process.exit(1);
  }
}
