const SpotifyWebApi = require('spotify-web-api-node');
const sinricWake = require('./sinricWake');
const SpotifySpeakerAccessory = require('./accessories/SpotifySpeakerAccessory');
const SpotifyBulbAccessory = require('./accessories/SpotifyBulbAccessory');
const SpotifyTvAccessory = require('./accessories/SpotifyTvAccessory');

const PLUGIN_NAME = 'homebridge-spotify-smart-speaker';
const PLATFORM_NAME = 'SpotifySmartSpeaker';

class SpotifyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.cachedAccessories = [];

    // Homebridge requirement shortcut definitions
    this.Service = api ? api.hap.Service : null;
    this.Characteristic = api ? api.hap.Characteristic : null;

    if (!config) {
      this.log.warn('[SpotifyPlatform] No configuration found in config.json.');
      return;
    }

    // Initialize Spotify API instance for the platform
    this.spotifyApi = new SpotifyWebApi({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      refreshToken: this.config.refreshToken,
    });

    // 1. Initialize Sinric Pro worker once at boot
    sinricWake.init(
      this.config.sinricAppKey,
      this.config.sinricAppSecret,
      this.config.sinricDeviceId,
      this.log
    );

    // 2. Register launch listener to publish external accessories
    if (this.api) {
      this.api.on('didFinishLaunching', async () => {
        await this.refreshSpotifyToken();
        this.discoverAndPublishAccessories();
      });
    }
  }

  /**
   * Required hook for Dynamic Platforms so Homebridge doesn't throw a TypeError.
   */
  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  /**
   * Authenticates against Spotify OAuth on boot.
   */
  async refreshSpotifyToken() {
    try {
      const data = await this.spotifyApi.refreshAccessToken();
      this.spotifyApi.setAccessToken(data.body['access_token']);
      this.log.info('[SpotifyPlatform] Successfully authenticated with Spotify API.');
    } catch (err) {
      this.log.error('[SpotifyPlatform] Failed to refresh Spotify token:', err.message);
    }
  }

  /**
   * Builds and publishes External Accessories (Speaker, Bulb, TV) directly to HomeKit.
   */
  discoverAndPublishAccessories() {
    const externalAccessories = [];
    const deviceName = this.config.name || 'Spotify Speaker';
    const deviceId = this.config.spotifyDeviceId;

    // --- 1. Speaker Accessory ---
    const speakerUuid = this.api.hap.uuid.generate(`spotify-speaker-${deviceId}`);
    const speakerAccessory = new this.api.platformAccessory(`${deviceName} Speaker`, speakerUuid);
    new SpotifySpeakerAccessory(this, speakerAccessory);
    externalAccessories.push(speakerAccessory);

    // --- 2. Bulb Accessory ---
    const bulbUuid = this.api.hap.uuid.generate(`spotify-bulb-${deviceId}`);
    const bulbAccessory = new this.api.platformAccessory(`${deviceName} Light`, bulbUuid);
    new SpotifyBulbAccessory(this, bulbAccessory);
    externalAccessories.push(bulbAccessory);

    // --- 3. TV Accessory (Requires External Accessory status in HomeKit) ---
    const tvUuid = this.api.hap.uuid.generate(`spotify-tv-${deviceId}`);
    const tvAccessory = new this.api.platformAccessory(
      `${deviceName} TV`,
      tvUuid,
      this.api.hap.Categories.TELEVISION
    );
    new SpotifyTvAccessory(this, tvAccessory);
    externalAccessories.push(tvAccessory);

    // Publish all 3 accessories externally to HomeKit
    this.log.info(`[SpotifyPlatform] Publishing ${externalAccessories.length} external accessories...`);
    this.api.publishExternalAccessories(PLUGIN_NAME, externalAccessories);
  }
}

module.exports = SpotifyPlatform;
