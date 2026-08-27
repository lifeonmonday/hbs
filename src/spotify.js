const SpotifyWebApi = require('spotify-web-api-node');

/**
 * Spotify Web API client wrapper
 * Handles authentication and playback control
 */
class SpotifyClient {
  constructor(config, log) {
    this.log = log;
    this.config = config;
    this.refreshToken = config.refreshToken || null;

    // Validate required config fields
    const required = ['clientId', 'clientSecret'];
    const missing = required.filter(field => !config[field]);
    if (missing.length > 0) {
      throw new Error(`SpotifyClient: Missing config fields: ${missing.join(', ')}`);
    }

    this.api = new SpotifyWebApi({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri || 'http://127.0.0.1:8888/callback'
    });
  }

  /**
   * Initialize authentication using authCode or refreshToken
   */
  async initializeAuth() {
    try {
      if (this.config.authCode && !this.refreshToken) {
        this.log.info('Exchanging authorization code for initial tokens...');
        const data = await this.api.authorizationCodeGrant(this.config.authCode);
        this.refreshToken = data.body['refresh_token'];
        this.api.setRefreshToken(this.refreshToken);
        this.api.setAccessToken(data.body['access_token']);

        this.log.info('----------------------------------------------------');
        this.log.info('YOUR REFRESH TOKEN (Save this in Homebridge Config):');
        this.log.info(this.refreshToken);
        this.log.info('----------------------------------------------------');
        return;
      }

      if (this.refreshToken) {
        this.api.setRefreshToken(this.refreshToken);
        await this.refreshTokens();
        return;
      }

      throw new Error('Neither authCode nor refreshToken provided in configuration.');
    } catch (err) {
      this.log.error('Authentication initialization failed:', err.message);
      throw err;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens() {
    try {
      const data = await this.api.refreshAccessToken();
      this.api.setAccessToken(data.body['access_token']);
      if (data.body['refresh_token']) {
        this.refreshToken = data.body['refresh_token'];
        this.api.setRefreshToken(this.refreshToken);
      }
    } catch (err) {
      this.log.error('Token refresh failed:', err.message);
      throw err;
    }
  }

  /**
   * Start playback on the specified device
   */
  async play(deviceId) {
    try {
      await this.refreshTokens();
      return await this.api.play({ device_id: deviceId });
    } catch (err) {
      this.log.error('Play command failed:', err.message);
      throw err;
    }
  }

  /**
   * Pause playback on the specified device
   */
  async pause(deviceId) {
    try {
      await this.refreshTokens();
      return await this.api.pause({ device_id: deviceId });
    } catch (err) {
      this.log.error('Pause command failed:', err.message);
      throw err;
    }
  }

  /**
   * Set volume on the specified device
   */
  async setVolume(volume, deviceId) {
    try {
      await this.refreshTokens();
      return await this.api.setVolume(volume, { device_id: deviceId });
    } catch (err) {
      this.log.error('Volume adjustment failed:', err.message);
      throw err;
    }
  }

  /**
   * Get current playback state
   */
  async getPlaybackState() {
    try {
      await this.refreshTokens();
      const response = await this.api.getMyCurrentPlaybackState();
      return response.body || null;
    } catch (err) {
      this.log.warn('Failed to get playback state:', err.message);
      return null;
    }
  }
}

module.exports = SpotifyClient;
