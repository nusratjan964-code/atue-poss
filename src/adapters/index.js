const YouTubeAdapter = require('./youtube');
const FacebookAdapter = require('./facebook');
const InstagramAdapter = require('./instagram');
const TikTokAdapter = require('./tiktok');

const adapters = {
  youtube: new YouTubeAdapter(),
  facebook: new FacebookAdapter(),
  instagram: new InstagramAdapter(),
  tiktok: new TikTokAdapter()
};

function getAdapter(platform) {
  if (!platform) return null;
  return adapters[platform.toLowerCase()] || null;
}

function registerAdapter(platform, adapterInstance) {
  adapters[platform.toLowerCase()] = adapterInstance;
}

module.exports = {
  adapters,
  getAdapter,
  registerAdapter
};
