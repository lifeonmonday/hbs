const SpotifyClient = require('./spotify');

class SpotifySmartSpeakerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Failed to initialize Spotify client:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = this.config.name || 'Spotify Speaker';
    const uuid = this.api.hap.uuid.generate(this.config.deviceId || 'spotify-smart-speaker');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.SPEAKER;
    this.setupTelevisionService(accessory);

    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupTelevisionService(accessory) {
    const tvService = accessory.addService(this.Service.Television);
    tvService.setCharacteristic(this.Characteristic.ConfiguredName, accessory.displayName);

    tvService.getCharacteristic(this.Characteristic.TargetMediaState)
      .onSet(async (value) => {
        if (value === this.Characteristic.TargetMediaState.PLAY) {
          await this.client.play(this.config.deviceId);
        } else {
          await this.client.pause(this.config.deviceId);
        }
      });
  }
}

module.exports = SpotifySmartSpeakerPlatform;
