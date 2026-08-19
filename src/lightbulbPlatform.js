const SpotifyClient = require('./spotify');

class SpotifyLightbulbPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);
    this.isPlaying = false;
    this.currentVolume = 50;

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Lightbulb Platform auth error:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = (this.config.name || 'Spotify Speaker') + ' (Light)';
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-light');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.LIGHTBULB;

    this.setupLightbulb(accessory);
    this.startPolling();

    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupLightbulb(accessory) {
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Lightbulb UI');

    this.service = accessory.addService(this.Service.Lightbulb, accessory.displayName);

    // On / Off (Tap tile to Play / Pause)
    this.service.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.isPlaying)
      .onSet(async (value) => {
        try {
          if (value) {
            await this.client.play(this.config.deviceId);
            this.isPlaying = true;
          } else {
            await this.client.pause(this.config.deviceId);
            this.isPlaying = false;
          }
        } catch (err) {
          this.log.error('Playback error:', err.message);
        }
      });

    // Brightness (Slider for Volume 0-100%)
    this.service.getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume error:', err.message);
        }
      });
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;
    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();
        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.isPlaying = false;
          this.service.updateCharacteristic(this.Characteristic.On, false);
          return;
        }

        this.isPlaying = state.is_playing;
        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.service.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        }

        this.service.updateCharacteristic(this.Characteristic.On, this.isPlaying);
      } catch (err) {}
    }, interval);
  }
}

module.exports = SpotifyLightbulbPlatform;
