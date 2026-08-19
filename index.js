const SpotifyWebApi = require('spotify-web-api-node');

const PLUGIN_NAME = 'homebridge-spotify-smart-speaker';
const PLATFORM_NAME = 'SpotifySmartSpeaker';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SpotifySmartSpeakerPlatform);
};

class SpotifySmartSpeakerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.spotifyApi = new SpotifyWebApi({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    });

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {}

  async discoverDevices() {
    try {
      const data = await this.spotifyApi.refreshAccessToken();
      this.spotifyApi.setAccessToken(data.body['access_token']);
      this.log.info('Spotify Access Token refreshed.');

      const deviceName = this.config.name || 'Spotify Speaker';
      const uuid = this.api.hap.uuid.generate(this.config.deviceId || 'spotify-smart-speaker');

      const accessory = new this.api.platformAccessory(deviceName, uuid);
      accessory.category = this.api.hap.Categories.SPEAKER;

      new SpotifySmartSpeakerAccessory(this, accessory);
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    } catch (error) {
      this.log.error('Init error:', error.message);
    }
  }
}

class SpotifySmartSpeakerAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;

    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;

    this.accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Speaker')
      .setCharacteristic(this.Characteristic.SerialNumber, this.platform.config.deviceId || '123456');

    this.service = this.accessory.getService(this.Service.Television) ||
                   this.accessory.addService(this.Service.Television);

    this.service.setCharacteristic(this.Characteristic.ConfiguredName, this.accessory.displayName);
    this.service.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    this.service.getCharacteristic(this.Characteristic.Active)
      .onGet(() => this.Characteristic.Active.ACTIVE);

    this.service.getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => this.currentMediaState);

    this.service.getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => this.targetMediaState)
      .onSet(this.setTargetMediaState.bind(this));

    this.service.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(this.handleRemoteKeyPress.bind(this));

    setInterval(() => this.pollSpotifyState(), 5000);
  }

  async setTargetMediaState(value) {
    this.targetMediaState = value;
    try {
      await this.refreshAccessTokenIfNeeded();

      if (value === this.Characteristic.TargetMediaState.PLAY) {
        await this.platform.spotifyApi.play({ device_id: this.platform.config.deviceId });
        this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
      } else if (value === this.Characteristic.TargetMediaState.PAUSE) {
        await this.platform.spotifyApi.pause({ device_id: this.platform.config.deviceId });
        this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
      }

      this.service.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
    } catch (error) {
      this.platform.log.error('Playback error:', error.message);
    }
  }

  async handleRemoteKeyPress(value) {
    if (value === this.Characteristic.RemoteKey.PLAY_PAUSE) {
      const newState = (this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY)
        ? this.Characteristic.TargetMediaState.PAUSE
        : this.Characteristic.TargetMediaState.PLAY;

      await this.setTargetMediaState(newState);
    }
  }

  async pollSpotifyState() {
    try {
      await this.refreshAccessTokenIfNeeded();
      const response = await this.platform.spotifyApi.getMyCurrentPlaybackState();

      if (response.body && response.body.is_playing) {
        this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
        this.targetMediaState = this.Characteristic.TargetMediaState.PLAY;
      } else {
        this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
        this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
      }

      this.service.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
      this.service.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
    } catch (error) {}
  }

  async refreshAccessTokenIfNeeded() {
    try {
      const data = await this.platform.spotifyApi.refreshAccessToken();
      this.platform.spotifyApi.setAccessToken(data.body['access_token']);
    } catch (error) {
      this.platform.log.error('Token refresh error:', error.message);
    }
  }
}
