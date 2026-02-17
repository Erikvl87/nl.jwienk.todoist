'use strict';

const { OAuth2Device } = require('homey-oauth2app');

class UserDevice extends OAuth2Device {
  /**
   * @override
   * @return {Promise<void>}
   */
  async onOAuth2Init() {
    this.log('onOAuth2Init');

    const data = this.getData();
    
    const isValid = await this.oAuth2Client.isTokenValid();
    if (!isValid) {
      this.log('OAuth token is invalid');
      await this.homey.notifications.createNotification({
        excerpt: this.homey.__('tokenInvalidTimeline', { name: this.getName() })
      });
      await this.setUnavailable(this.homey.__('tokenInvalid'));
      return;
    }
    this.log('OAuth token is valid');
    await this.setAvailable();

    await this.homey.app.registerWebhookData({ data });
  }

  /**
   * @override
   * @return {Promise<void>}
   */
  async onOAuth2Deleted() {
    // Clean up here
  }
}

module.exports = UserDevice;
