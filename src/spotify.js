const SpotifyWebApi = require('spotify-web-api-node');

class SpotifyClient {
  constructor(config, log) {
    this.log = log;
    this.config = config;
    this.refreshToken = config.refreshToken || null;

    this.api = new SpotifyWebApi({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri || 'http://127.0.0.1:8888/callback'
    });
  }

  async initializeAuth() {
    // Flow 1: Perform initial authorization code exchange
    if (this.config.authCode && !this.refreshToken) {
      this.log.info('Exchanging authorization code for tokens...');
      const data = await this.api.authorizationCodeGrant(this.config.authCode);
      this.refreshToken = data.body['refresh_token'];
      this.api.setRefreshToken(this.refreshToken);
      this.api.setAccessToken(data.body['access_token']);
      this.log.info('Successfully acquired initial Refresh Token.');
      return;
    }

    // Flow 2: Use existing refresh token
    if (this.refreshToken) {
      this.api.setRefreshToken(this.refreshToken);
      await this.refreshTokens();
      return;
    }

    throw new Error('Neither authCode nor refreshToken provided in config.');
  }

  async refreshTokens() {
    const data = await this.api.refreshAccessToken();
    this.api.setAccessToken(data.body['access_token']);
    if (data.body['refresh_token']) {
      this.refreshToken = data.body['refresh_token'];
      this.api.setRefreshToken(this.refreshToken);
    }
  }

  async play(deviceId) {
    await this.refreshTokens();
    return this.api.play({ device_id: deviceId });
  }

  async pause(deviceId) {
    await this.refreshTokens();
    return this.api.pause({ device_id: deviceId });
  }

  async getState() {
    await this.refreshTokens();
    return this.api.getMyCurrentPlaybackState();
  }
}

module.exports = SpotifyClient;
