const SpotifyClient = require('./spotify');

class SpotifySpeakerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.baseName = this.config.name || 'Spotify';
    this.currentVolume = 30;
    this.isMuted = false;

    this.client = new SpotifyClient(this.config, this.log);

    // Wywołujemy rejestrację dopiero po pełnym wybudzeniu Homebridge
    this.api.on('didFinishLaunching', () => {
      this.setupAndRegisterAccessory();
    });

    this.startPolling();
  }

  setupAndRegisterAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-speaker-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(`${this.baseName} Speaker`, uuid);

    // USŁUGA SPEAKER
    this.speakerService = accessory.addService(this.Service.Speaker, `${this.baseName} Speaker`);

    // 1. MUTE
    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => this.isMuted)
      .onSet(async (value) => {
        this.isMuted = value;
        const targetVolume = this.isMuted ? 0 : this.currentVolume;

        try {
          await this.client.setVolume(targetVolume, this.config.deviceId);
          this.log.info(`Mute set to: ${this.isMuted}`);
        } catch (err) {
          this.log.error('Failed to change mute state:', err.message);
        }
      });

    // 2. VOLUME
    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        this.currentVolume = value;
        this.isMuted = (value === 0);

        try {
          await this.client.setVolume(this.currentVolume, this.config.deviceId);
          this.log.info(`Speaker volume set to: ${this.currentVolume}%`);
        } catch (err) {
          this.log.error('Failed to set speaker volume:', err.message);
        }
      });

    // REJESTRACJA AKCESORIUM W MAIN BRIDGE
    this.api.registerPlatformAccessories('homebridge-spotify-tv', 'SpotifySpeaker', [accessory]);
    this.log.info(`Registered Speaker accessory: ${this.baseName} Speaker`);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();

        if (state && state.device && state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.isMuted = (this.currentVolume === 0);

          if (this.speakerService) {
            this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
            this.speakerService.updateCharacteristic(this.Characteristic.Mute, this.isMuted);
          }
        }
      } catch (err) {
        // Cichy przechwytywacz błędów w tle
      }
    }, interval);
  }
}

module.exports = SpotifySpeakerPlatform;
