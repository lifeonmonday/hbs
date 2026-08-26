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
            // 1. Próba bezpośredniego odtworzenia (szybka ścieżka)
            await this.client.play(this.config.deviceId);
            this.isPlaying = true;
          } catch (err) {
            this.log.warn('Direct play failed (Nest speaker likely idle). Attempting wake-up trigger...');

            try {
              // 2. Wyzwolenie przełącznika budzącego
              await this.triggerClient.triggerWakeupSwitch();

              // 3. Ponowna próba po obudzeniu
              await this.client.play(this.config.deviceId);
              this.isPlaying = true;
            } catch (retryErr) {
              this.log.error('Playback failed even after wake-up trigger:', retryErr.message);

              // Cofnięcie stanu przełącznika w Apple Home w razie porażki
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

    // ROTATION SPEED CHARACTERISTIC (Głośność z krokami pod kreski)
    this.service.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 65,
        minStep: 15
      }) 
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
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
