'use strict';

const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');
const { TodoistClient } = require('./lib/TodoistClient');

// if (process.env.DEBUG === '1') {
//   require('inspector').open(9229, '0.0.0.0', false);
// }

class App extends OAuth2App {
  // static OAUTH2_CLIENT = TodoistClient; // Default: OAuth2Client
  // static OAUTH2_DEBUG = false; // Default: false
  // static OAUTH2_MULTI_SESSION = true; // Default: false
  // static OAUTH2_DRIVERS = [ 'user' ]; // Default: all drivers

  /**
   * @override
   * @return {Promise<void>}
   */
  async onOAuth2Init() {
    this.log('onOAuth2Init');

    this.enableOAuth2Debug();
    this.setOAuth2Config({
      client: TodoistClient,
      clientId: Homey.env.CLIENT_ID,
      clientSecret: Homey.env.CLIENT_SECRET,
      grantType: 'authorization_code',
      apiUrl: 'https://api.todoist.com',
      tokenUrl: 'https://todoist.com/oauth/access_token',
      authorizationUrl: 'https://todoist.com/oauth/authorize',
      redirectUrl: 'https://callback.athom.com/oauth2/callback',
      scopes: ['data:read_write'],
      allowMultiSession: true
    });

    this.ids = new Set();
    this.webhook = null;
  }

  async registerWebhookData({ data }) {
    if (this.webhook) {
      await this.webhook.unregister();
    }

    this.ids.add(data.id);

    const id = Homey.env.WEBHOOK_ID;
    const secret = Homey.env.WEBHOOK_SECRET;
    const ids = [...this.ids];

    const myWebhook = await this.homey.cloud.createWebhook(id, secret, { $keys: ids });

    myWebhook.on('message', (args) => {
      const driver = this.homey.drivers.getDriver('user');
      driver.onWebhookEvent({ body: args.body });
    });
  }
}

module.exports = App;
