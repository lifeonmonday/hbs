const SpotifyClient = require('./spotify');

class SpotifySmartSpeakerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);

    // Stany początkowe SmartSpeaker
    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
    this.currentVolume = 50;

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
    // 1. Zmiana domyślnej nazwy na 'Spotify Speaker'
    const name = this.config.name || 'Spotify Speaker';
    const uuid = this.api.hap.uuid.generate(this.config.deviceId || 'spotify-smart-speaker');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.SPEAKER;

    this.setupSmartSpeaker(accessory);
    this.startPolling();

    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupSmartSpeaker(accessory) {
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Smart Speaker')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '123456');

    // Główna usługa SmartSpeaker
    this.speakerService = accessory.addService(this.Service.SmartSpeaker, accessory.displayName);

    // CurrentMediaState: Odczyt stanu (PLAY, PAUSE, STOP)
    this.speakerService.getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => this.currentMediaState);

    // TargetMediaState: Sterowanie (Play / Pause z kafelka)
    this.speakerService.getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => this.targetMediaState)
      .onSet(async (value) => {
        this.targetMediaState = value;
        try {
          if (value === this.Characteristic.TargetMediaState.PLAY) {
            await this.client.play(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
          } else if (value === this.Characteristic.TargetMediaState.PAUSE) {
            await this.client.pause(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          } else {
            await this.client.pause(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.STOP;
          }
          
          this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
        } catch (err) {
          this.log.error('Playback state change error:', err.message);
        }
      });

    // 3. Głośność (Volume)
    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume adjustment error:', err.message);
        }
      });
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();

        // 2. Obsługa braku sesji / zniknięcia Chromecast z listy Spotify Connect
        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.currentMediaState = this.Characteristic.CurrentMediaState.STOP;
          this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
          
          this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
          this.speakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
          return;
        }

        // Stan gdy urządzenie jest aktywne w Spotify
        if (state.is_playing) {
          this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
          this.targetMediaState = this.Characteristic.TargetMediaState.PLAY;
        } else {
          this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
        }

        // Aktualizacja głośności ze Spotify
        if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        }

        this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
        this.speakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
      } catch (err) {
        // Ciche odrzucenie błędów tła przy odświeżaniu
      }
    }, interval);
  }
}

module.exports = SpotifySmartSpeakerPlatform;
