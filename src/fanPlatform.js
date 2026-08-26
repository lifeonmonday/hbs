const SpotifyClient = require('./spotify');
const TriggerClient = require('./trigger');

class SpotifyFanPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);
    this.triggerClient = new TriggerClient(config, log, this); 
    this.isPlaying = false;
    this.currentVolume = 30;

    // Pobranie limitu z configu lub domyślnie 65%
    this.maxVolumeLimit = this.config.maxVolume || 65; 

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Błąd startu platformy Fan:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = (this.config.name || 'Spotify Fan Speaker') + ' Fan';
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-fan-test');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.FAN;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Fan UI');

    this.service = accessory.addService(this.Service.Fanv2, accessory.displayName);

    // ACTIVE CHARACTERISTIC (Fanv2 ON/OFF)
    this.service.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const isActive = value === this.Characteristic.Active.ACTIVE;
        
        if (isActive) {
          try {
            await this.client.play(this.config.deviceId);
            this.isPlaying = true;
          } catch (err) {
            this.log.warn('Direct play failed. Attempting wake-up trigger...');
            try {
              await this.triggerClient.triggerWakeupSwitch();
              await this.client.play(this.config.deviceId);
              this.isPlaying = true;
            } catch (retryErr) {
              this.log.error('Playback failed after trigger:', retryErr.message);
              this.isPlaying = false;
              setTimeout(() => {
                this.service.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
              }, 500);
            }
          }
        } else {
          try {
            await this.client.pause(this.config.deviceId);
            this.isPlaying = false;
          } catch (err) {
            this.log.error('Błąd pauzowania Fan:', err.message);
          }
        }
      });

    // ROTATION SPEED CHARACTERISTIC (Głośność ze stałym zakresem 0-100)
    this.service.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100, // ZAWSZE 100!
        minStep: 20    // Dokładnie 5 kroków (20, 40, 60, 80, 100) pod kreski w iOS
      }) 
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        // Obcinanie wartości do ustalonego limitu w kodzie
        const targetVolume = Math.min(value, this.maxVolumeLimit);

        try {
          await this.client.setVolume(targetVolume, this.config.deviceId);
          this.currentVolume = targetVolume;
        } catch (err) {
          this.log.error('Błąd głośności Fan:', err.message);
        }
      });

    this.startPolling();
    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;
    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();
        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.isPlaying = false;
          this.service.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
          return;
        }

        this.isPlaying = state.is_playing;
        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.service.updateCharacteristic(this.Characteristic.RotationSpeed, this.currentVolume);
        }

        this.service.updateCharacteristic(
          this.Characteristic.Active, 
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );
      } catch (err) {}
    }, interval);
  }
}

module.exports = SpotifyFanPlatform;
