const sinricWake = require('./sinricWake');
const SpotifySpeakerAccessory = require('./accessories/SpotifySpeakerAccessory');
const SpotifyBulbAccessory = require('./accessories/SpotifyBulbAccessory'); // Fixed reference
const SpotifyTvAccessory = require('./accessories/SpotifyTvAccessory');

class SpotifyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config) {
      this.log.warn('No configuration found for SpotifyPlatform.');
      return;
    }

    // Initialize Sinric Pro worker once on platform boot
    sinricWake.init(
      this.config.sinricAppKey,
      this.config.sinricAppSecret,
      this.config.sinricDeviceId,
      this.log
    );

    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.discoverDevices();
      });
    }
  }

  discoverDevices() {
  }
}

module.exports = SpotifyPlatform;