const SpotifyClient = require('./spotify');

class SpotifyTVPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);
    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.currentVolume = 50;

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Błąd startu platformy AVR:', err.message);
      }
    });
  }

  registerAccessory() {
    // Usunięto nawiasy (), aby uniknąć ostrzeżeń HAP
    const name = (this.config.name || 'Spotify Speaker') + ' AVR';
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-avr-test');
    const accessory = new this.api.platformAccessory(name, uuid);

    // Kategoria zmieniona na AUDIO_RECEIVER
    accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect AVR UI');

    this.tvService = accessory.addService(this.Service.Television, accessory.displayName);
    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, accessory.displayName);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // Stan zasilania / odtwarzania (Active)
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0))
      .onSet(async (value) => {
        try {
          if (value) {
            await this.client.play(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
          } else {
            await this.client.pause(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          }
        } catch (err) {
          this.log.error('Błąd odtwarzania AVR:', err.message);
        }
      });

    // Usługa Speaker do obsługi głośności oraz przycisków fizycznych
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, `${accessory.displayName} Volume`);
    
    this.speakerService.setCharacteristic(
      this.Characteristic.VolumeControlType,
      this.Characteristic.VolumeControlType.ABSOLUTE
    );

    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Błąd głośności AVR:', err.message);
        }
      });

    // Skoki głośności przyciskami fizycznymi na telefonie (+/- 5%)
    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        try {
          const step = value === this.Characteristic.VolumeSelector.INCREMENT ? 5 : -5;
          const newVol = Math.min(100, Math.max(0, this.currentVolume + step));
          await this.client.setVolume(newVol, this.config.deviceId);
          this.currentVolume = newVol;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        } catch (err) {
          this.log.error('Błąd przycisków głośności AVR:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    this.startPolling();
    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;
    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();
        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          this.tvService.updateCharacteristic(this.Characteristic.Active, 0);
          return;
        }

        this.currentMediaState = state.is_playing
          ? this.Characteristic.CurrentMediaState.PLAY
          : this.Characteristic.CurrentMediaState.PAUSE;

        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        }

        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0
        );
      } catch (err) {}
    }, interval);
  }
}

module.exports = SpotifyTVPlatform;
