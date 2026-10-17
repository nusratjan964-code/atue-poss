# 🚀 Drive2Social AI — AI-Powered Google Drive to Social Media Auto Publisher

**Drive2Social AI** is a production-oriented, automated social media video publishing suite. It connects your **Google Drive**, streams and inspects video content, analyzes the actual visual and audio footage using Google's **Gemini Multimodal Flash API**, generates platform-tailored captions, titles, descriptions, and hashtags (in Bangla, English, or Banglish), and publishes up to **3 unique videos per calendar day** across **YouTube Shorts**, **Facebook Page Reels**, **Instagram Reels**, and **TikTok**.

---

## 🌟 Key Features

1. **📁 Official Google Drive Integration**
   - Connect securely via Google OAuth 2.0 with minimal required scopes.
   - Folder selector supporting Drive folders with recursive video retrieval.
   - Memory-efficient streaming with HTTP Range headers (no browser RAM exhaustion on large video files).
   - Video library management: view file size, format, duration, preview video thumbnails, and exclude/pause individual videos.

2. **🤖 Gemini Multimodal AI Video Analysis**
   - Analyzes actual visual footage and spoken audio context using Google's latest `gemini-2.5-flash` model (configurable via `GEMINI_MODEL`).
   - Generates structured JSON containing:
     - Video summary & main topic.
     - Attention-grabbing opening hook.
     - YouTube Title (strictly $\le 100$ chars) & Description with tags.
     - Facebook Caption & Reels hashtags.
     - Instagram Caption ($\le 2200$ chars, max 30 hashtags).
     - TikTok Caption ($\le 2200$ chars).
     - Content warnings & rationale explanation.
   - Language customization: **বাংলা (Bangla)**, **English**, or **Banglish**.
   - Style controls: **Entertaining**, **Educational**, **Storytelling**, **Professional**, or **Promotional**.

3. **⏱️ Strict 3-Video Daily Limit & Concurrency Scheduler**
   - Automatically processes up to **3 unique videos per calendar day** (configurable).
   - Daily quota resets at midnight in your configured timezone (default: `Asia/Dhaka`).
   - Concurrency locking ensures only one worker claims a video job at a time.
   - **Duplicate Post Prevention**: Checks publish history so a video is never posted twice to the same account unless explicitly cleared.

4. **🛡️ Dual Publishing Modes**
   - **Review Mode (Default):** Videos are analyzed by Gemini and queued at `awaiting_approval`. You can preview the video, inspect and edit captions, and click **Approve & Publish**.
   - **Automatic Mode:** Once enabled, the background worker automatically processes and publishes eligible videos on schedule without requiring manual clicks.

5. **🌐 Modular Social Media Adapters**
   - **YouTube Data API v3:** Uploads Shorts with title, description, tags, category, and privacy controls (public, unlisted, private test uploads).
   - **Meta Graph API (Facebook):** Publishes Reels to Facebook Pages with numeric ID resolution and token validation.
   - **Meta Graph API (Instagram):** Two-step media container creation and publishing for Instagram Professional/Creator accounts.
   - **TikTok Content Posting API:** Direct upload and draft workflow with clear developer audit disclosures.

6. **🔒 Enterprise Security & Cost Controls**
   - Zero secrets exposed in client-side code.
   - OAuth tokens encrypted at rest using AES-256-GCM.
   - Gemini token and request usage tracker with estimated cost calculations.
   - Real-time audit logs tracking all system events.

---

## 📂 System Architecture

```
drive2tube-autoposter/
├── server.js                 # Express server & background scheduler starter
├── package.json              # Dependencies and scripts (npm test, npm start)
├── .env.example              # Environment variables template
├── .env                      # Local configuration (never committed to git)
├── data/
│   └── database.json         # Atomic JSON database (settings, accounts, queue, audit logs)
├── public/                   # Frontend SPA (Vanilla JS + Glassmorphic CSS)
│   ├── index.html            # 6-panel responsive dashboard
│   ├── css/style.css         # Modern dark SaaS design system
│   └── js/app.js             # Client SPA controller
├── src/
│   ├── config/index.js       # Central configuration & defaults
│   ├── security/crypto.js    # AES-256-GCM token encryption helpers
│   ├── database/index.js     # Atomic file DB with temp-swap writes
│   ├── services/
│   │   ├── googleDrive.js    # Drive API & video streaming
│   │   ├── geminiAi.js       # Multimodal Gemini API & heuristic fallback
│   │   ├── scheduler.js      # 3-video/day scheduler & worker locking
│   │   └── costTracker.js    # Token tracking & cost estimation
│   ├── adapters/
│   │   ├── baseAdapter.js    # Base social adapter interface
│   │   ├── youtube.js        # YouTube Data API v3 adapter
│   │   ├── facebook.js       # Meta Graph API Facebook Page Reels adapter
│   │   ├── instagram.js      # Instagram Graph API Reels adapter
│   │   ├── tiktok.js         # TikTok Content Posting API adapter
│   │   └── index.js          # Adapter registry and factory
│   └── routes/
│       ├── auth.js           # Google OAuth routes
│       ├── drive.js          # Folder sync, streaming, exclude toggle
│       ├── ai.js             # AI analysis endpoints
│       ├── queue.js          # Queue management & approval
│       ├── accounts.js       # Social accounts CRUD & connection tests
│       ├── settings.js       # Settings & cost control
│       └── stats.js          # Live KPIs & audit logs
└── tests/                    # Automated Test Suite
    ├── crypto.test.js        # AES-256-GCM encryption tests
    ├── adapters.test.js      # Platform metadata validation tests
    ├── gemini.test.js        # JSON schema & fallback tests
    ├── duplicate.test.js     # Duplicate prevention tests
    ├── scheduler.test.js     # Daily limit & Review Mode tests
    └── run-all.js            # Master test runner
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v18+ (tested on Node.js v22).
- Google Cloud Project with Drive API enabled (or standard Drive link access).
- Gemini API key from [Google AI Studio](https://aistudio.google.com/).

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/mdnahid7653959-spec/drive2tube-autoposter.git
cd drive2tube-autoposter

# Install dependencies
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` with your values:
```env
PORT=3000
NODE_ENV=development
APP_SECRET=your_super_secret_32_byte_hex_passphrase_here

# Gemini API
GEMINI_API_KEY=your_gemini_api_key_from_google_ai_studio
GEMINI_MODEL=gemini-2.5-flash

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Default Settings
DEFAULT_TIMEZONE=Asia/Dhaka
DAILY_LIMIT=3
```

### 4. Run Automated Tests
```bash
npm test
```
All unit and integration tests (Crypto, Adapters, Gemini schema, Duplicate prevention, Daily scheduler) should pass with 0 errors.

### 5. Launch Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔑 Platform Setup & Credentials

### A. Google Drive & YouTube Setup (Google Cloud Console)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `Drive2Social-Publisher`).
3. Enable **Google Drive API** and **YouTube Data API v3**.
4. Configure **OAuth Consent Screen**:
   - User Type: External (Testing).
   - Add scopes:
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/youtube.upload`
   - Add your Google account under **Test Users**.
5. Create **OAuth 2.0 Client ID**:
   - Application type: Web application.
   - Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`.
6. Copy Client ID and Secret into your `.env` file.

### B. Gemini API Key (Google AI Studio)
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create a free API key.
3. Paste the key into `GEMINI_API_KEY` in `.env` (or via the **Settings** tab in the dashboard).
4. Free tier provides generous RPM (requests per minute) suitable for daily batch processing.

### C. Meta for Developers (Facebook Pages & Instagram)
1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Create a Business App.
3. Add **Facebook Login for Business** and **Instagram Graph API**.
4. Generate a **Page Access Token** with permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
5. In the **Social Accounts** tab of Drive2Social AI, click **Add Account** -> select Facebook or Instagram, enter your Page ID / Instagram User ID, and paste the access token. The token is immediately encrypted with AES-256-GCM.

### D. TikTok Content Posting API
1. Register at [TikTok for Developers](https://developers.tiktok.com/).
2. Create an app and apply for **Content Posting API**.
3. Required Scopes: `video.upload`, `video.publish`.
4. *Notice:* TikTok requires a developer audit before direct video publishing is allowed on production accounts. In testing mode, videos can be uploaded as drafts for in-app review.

---

## 🎯 Verification & Testing Evidence

The test suite validates the following core guarantees:
- **Daily Quota Ceiling:** When 3 videos have been published today, `processSchedulerTick()` halts with `status: quota_reached` and postpones processing until midnight (`Asia/Dhaka`).
- **Duplicate Prevention:** Even if a folder contains 100 videos, each video is checked against `publishedPosts`. Once posted to an account, it is never posted there again.
- **Review Mode Safety:** The system never publishes to social media without human review unless you explicitly toggle off Review Mode in Settings.
- **Fallback Resilience:** If offline or if the Gemini API key is temporarily exhausted, the system automatically uses a smart heuristic generator so your publishing queue never crashes.

---

## 📜 License
MIT License &copy; 2026 Drive2Social AI Team.
