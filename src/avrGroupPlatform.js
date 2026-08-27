const SpotifyClient = require('./spotify');

class SpotifyAvrGroupPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.name = this.config.name || 'Spotify AVR';
    this.deviceId = this.config.deviceId;

    this.currentVolume = 30;
    this.isPlaying = false;

    // Inicjalizacja klienta Spotify
    this.client = new SpotifyClient(this.config, this.log);

    this.api.on('didFinishLaunching', async () => {
      try {
        // 1. Zabezpieczenie Auth: Upewniamy się, że klient wczytał tokeny z dysku
        if (typeof this.client.init === 'function') {
          await this.client.init();
        }

        // 2. Tworzymy i publikujemy akcesorium
        this.setupAndRegisterAccessory();
        this.startPolling();
      } catch (err) {
        this.log.error('Failed to initialize Spotify Client:', err.message);
      }
    });
  }
  setupAndRegisterAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-avr-group-${this.deviceId || 'default'}`);
    
    // Tworzymy akcesorium
    this.accessory = new this.api.platformAccessory(this.name, uuid);

    // --------------------------------------------------------
    // KLUCZOWY BRAKUJĄCY ELEMENT: KATEGORIA AKCESORIUM
    // --------------------------------------------------------
    this.accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;

    // --------------------------------------------------------
    // SERWIS 1: TELEVISION (AVR)
    // --------------------------------------------------------
    this.tvService = this.accessory.addService(this.Service.Television, this.name, 'main-avr');
    
    // Ustawienie typu urządzenia w servisie TV
    this.tvService.setCharacteristic(
      this.Characteristic.TelevisionDeviceType,
      this.Characteristic.TelevisionDeviceType.AUDIO_RECEIVER
    );

    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, this.name);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // Pilot z Centrum Sterowania (Fizyczne przyciski głośności w iPhonie)
    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(async (newValue) => {
        try {
          switch (newValue) {
            case this.Characteristic.RemoteKey.REWIND:
              await this.client.previousTrack(this.deviceId);
              break;
            case this.Characteristic.RemoteKey.FAST_FORWARD:
              await this.client.nextTrack(this.deviceId);
              break;
          }
        } catch (err) {
          this.log.error('Remote key error:', err.message);
        }
      });

    // --------------------------------------------------------
    // SERWIS 2: LIGHTBULB (Suwak Głośności 0-100%)
    // --------------------------------------------------------
    this.volumeService = this.accessory.addService(
      this.Service.Lightbulb,
      `${this.name} Volume`,
      'volume-slider'
    );

    // Włączanie/wyłączanie (jako Mute/Unmute)
    this.volumeService.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.currentVolume > 0)
      .onSet(async (value) => {
        const targetVol = value ? (this.currentVolume || 30) : 0;
        try {
          await this.client.setVolume(targetVol, this.deviceId);
        } catch (err) {
          this.log.error('Failed to set mute via lightbulb:', err.message);
        }
      });

    // Jasność Żarówki = Głośność w Spotify
    this.volumeService.getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        this.currentVolume = value;
        try {
          await this.client.setVolume(this.currentVolume, this.deviceId);
          this.log.info(`AVR Volume set via slider to: ${this.currentVolume}%`);
        } catch (err) {
          this.log.error('Failed to set volume via slider:', err.message);
        }
      });

    // Powiązanie usług (Linked Services) - podpowiada iOS, że to jedno urządzenie
    this.tvService.addLinkedService(this.volumeService);

    // Rejestracja jako External Accessory (Wymagane dla serwisu Television)
    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [this.accessory]);
    this.log.info(`Published Grouped AVR Accessory: ${this.name}`);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();

        if (state) {
          this.isPlaying = state.is_playing;
          if (state.device && state.device.volume_percent !== null) {
            this.currentVolume = state.device.volume_percent;
          }

          // Aktualizacja stanu AVR
          if (this.tvService) {
            this.tvService.updateCharacteristic(this.Characteristic.Active, this.isPlaying ? 1 : 0);
          }

          // Aktualizacja stanu Suwaka
          if (this.volumeService) {
            this.volumeService.updateCharacteristic(this.Characteristic.On, this.currentVolume > 0);
            this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
          }
        }
      } catch (err) {
        // Cichy łapacz błędów w tle
      }
    }, interval);
  }
}

module.exports = SpotifyAvrGroupPlatform;
