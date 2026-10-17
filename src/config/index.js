const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATA_DIR: isServerless ? path.join(os.tmpdir(), 'drive2social_data') : path.join(__dirname, '../../data'),
  TEMP_DIR: isServerless ? path.join(os.tmpdir(), 'drive2social_temp') : path.join(__dirname, '../../temp'),
  
  // Security
  APP_SECRET: process.env.APP_SECRET || 'drive2social-default-secret-key-32chars!!',
  
  // Google OAuth & Drive
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
  
  // Gemini AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  
  // Scheduler defaults
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || 'Asia/Dhaka',
  DEFAULT_DAILY_LIMIT: parseInt(process.env.DAILY_VIDEO_LIMIT || '3', 10),
  
  // Platform configs
  YOUTUBE_ENABLED: process.env.YOUTUBE_ENABLED !== 'false',
  FACEBOOK_ENABLED: process.env.FACEBOOK_ENABLED !== 'false',
  INSTAGRAM_ENABLED: process.env.INSTAGRAM_ENABLED !== 'false',
  TIKTOK_ENABLED: process.env.TIKTOK_ENABLED !== 'false'
};
