/**
 * Base Social Media Publishing Adapter
 */
class BaseAdapter {
  constructor(platform) {
    this.platform = platform;
  }

  getName() {
    return this.platform;
  }

  isConfigured(account) {
    return !!(account && account.connected && account.tokenEncrypted);
  }

  validateMetadata(metadata) {
    return { valid: true };
  }

  async publishVideo({ video, metadata, account, options = {} }) {
    throw new Error(`publishVideo() not implemented for ${this.platform}`);
  }
}

module.exports = BaseAdapter;
