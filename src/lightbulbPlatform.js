const SpotifyClient = require('./spotify');
const TriggerClient = require('./trigger'); 

class SpotifyLightbulbPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);
    this.triggerClient = new TriggerClient(config, log); 
    this.isPlaying = false;
    this.currentVolume = 30;

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Błąd startu platformy Lightbulb:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = (this.config.name || 'Spotify Lightbulb Speaker') + ' Light';
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-light-test');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.LIGHTBULB;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Light UI');

    this.service = accessory.addService(this.Service.Lightbulb, accessory.displayName);

    // BLACH/ON CHARACTERISTIC (Włączenie/Wyłączenie)
    this.service.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.isPlaying)
      .onSet(async (value) => {
        if (value) {
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
                this.service.updateCharacteristic(this.Characteristic.On, false);
              }, 500);
            }
          }
        } else {
          try {
            await this.client.pause(this.config.deviceId);
            this.isPlaying = false;
          } catch (err) {
            this.log.error('Błąd pauzowania Lightbulb:', err.message);
          }
        }
      });

    // BRIGHTNESS CHARACTERISTIC (Głośność ze skokiem co 5)
    this.service.getCharacteristic(this.Characteristic.Brightness)
      .setProps({
        minValue: 0,
        maxValue: 80,
        minStep: 5
      }) 
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Błąd głośności Lightbulb:', err.message);
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
