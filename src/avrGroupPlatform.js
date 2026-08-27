const SpotifyClient = require('./spotify');

class SpotifyAvrGroupPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);
    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.currentVolume = 30;
    this.currentTrack = '';
    this.baseName = this.config.name || 'Spotify AVR Group';

    this.api.on('didFinishLaunching', async () => {
      try {
        // Poprawna nazwa metody autoryzacji z Twojego spotify.js
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Błąd startu platformy AVR Group:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = this.baseName;
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-avr-group');
    const accessory = new this.api.platformAccessory(name, uuid);

    // Rejestracja kategorii AVR (Audio Receiver)
    accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect AVR Group UI');

    // --------------------------------------------------------
    // USŁUGA 1: TELEVISION (Główny AVR z Pilotem iOS)
    // --------------------------------------------------------
    this.tvService = accessory.addService(this.Service.Television, accessory.displayName);
    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, name);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // Stan odtwarzania (Play / Pause)
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
          this.log.error('Błąd sterowania zasilaniem:', err.message);
        }
      });

    // Przechwytywanie przycisków z pilota iOS w Centrum Sterowania
    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(async (value) => {
        try {
          if (value === this.Characteristic.RemoteKey.PLAY_PAUSE) {
            const isPlaying = this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY;
            if (isPlaying) {
              await this.client.pause(this.config.deviceId);
            } else {
              await this.client.play(this.config.deviceId);
            }
          }
        } catch (err) {
          this.log.error('Błąd przycisku pilota:', err.message);
        }
      });

    // --- Usługa Głośności dla Pilota (TelevisionSpeaker) ---
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, `${accessory.displayName} Remote Vol`);
    this.speakerService.setCharacteristic(
      this.Characteristic.VolumeControlType,
      this.Characteristic.VolumeControlType.ABSOLUTE
    );

    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        try {
          const step = value === this.Characteristic.VolumeSelector.INCREMENT ? 5 : -5;
          const newVol = Math.min(100, Math.max(0, this.currentVolume + step));
          await this.client.setVolume(newVol, this.config.deviceId);
          this.currentVolume = newVol;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          if (this.lightbulbService) {
            this.lightbulbService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
          }
        } catch (err) {
          this.log.error('Błąd przycisków głośności:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // --------------------------------------------------------
    // USŁUGA 2: LIGHTBULB (Natywny Suwak Głośności 0-100%)
    // --------------------------------------------------------
    this.lightbulbService = accessory.addService(this.Service.Lightbulb, `${accessory.displayName} Slider`);
    
    // Włączenie/Wyłączenie żarówki = Mute / Resume
    this.lightbulbService.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.currentVolume > 0)
      .onSet(async (value) => {
        try {
          const targetVol = value ? (this.currentVolume > 0 ? this.currentVolume : 30) : 0;
          await this.client.setVolume(targetVol, this.config.deviceId);
        } catch (err) {
          this.log.error('Błąd włącznika suwaka:', err.message);
        }
      });

    // Jasność żarówki = Suwak Głośności 0-100%
    this.lightbulbService.getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          this.currentVolume = value;
          await this.client.setVolume(this.currentVolume, this.config.deviceId);
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        } catch (err) {
          this.log.error('Błąd ustawiania suwaka głośności:', err.message);
        }
      });

    // Łączymy usługę suwaka z głównym AVR
    this.tvService.addLinkedService(this.lightbulbService);

    // --------------------------------------------------------
    // INPUT SOURCES (Rozwijana lista głośności z Twojej wersji)
    // --------------------------------------------------------
    this.setupVolumeInputSources(accessory);

    // Start odpytywania stanu i publikacja w HAP
    this.startPolling();
    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupVolumeInputSources(accessory) {
    const levels = [
      { id: 1, name: 'Volume 10%', vol: 10 },
      { id: 2, name: 'Volume 15%', vol: 15 },
      { id: 3, name: 'Volume 20%', vol: 20 },
      { id: 4, name: 'Volume 30%', vol: 30 },
      { id: 5, name: 'Volume 40%', vol: 40 }
    ];

    levels.forEach((level) => {
      const inputService = accessory.addService(
        this.Service.InputSource,
        `vol_${level.vol}`,
        level.name
      );

      inputService
        .setCharacteristic(this.Characteristic.Identifier, level.id)
        .setCharacteristic(this.Characteristic.ConfiguredName, level.name)
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED
        )
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.APPLICATION
        );

      this.tvService.addLinkedService(inputService);
    });

    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => this.getActiveInputIdentifier(this.currentVolume))
      .onSet(async (value) => {
        const targetLevel = levels.find((l) => l.id === value);
        if (targetLevel) {
          try {
            await this.client.setVolume(targetLevel.vol, this.config.deviceId);
            this.currentVolume = targetLevel.vol;
            this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
            if (this.lightbulbService) {
              this.lightbulbService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
            }
          } catch (err) {
            this.log.error('Błąd zmiany poziomu z listy:', err.message);
          }
        }
      });
  }

  getActiveInputIdentifier(vol) {
    if (vol <= 12) return 1;
    if (vol <= 17) return 2;
    if (vol <= 25) return 3;
    if (vol <= 35) return 4;
    return 5;
  }

  syncActiveInputWithVolume(vol) {
    const id = this.getActiveInputIdentifier(vol);
    this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, id);
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

        if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          if (this.lightbulbService) {
            this.lightbulbService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
            this.lightbulbService.updateCharacteristic(this.Characteristic.On, this.currentVolume > 0);
          }
          this.syncActiveInputWithVolume(this.currentVolume);
        }

        if (state.item) {
          const trackName = `${state.item.name} · ${state.item.artists.map((a) => a.name).join(', ')}`;
          if (this.currentTrack !== trackName) {
            this.currentTrack = trackName;
            this.tvService.updateCharacteristic(this.Characteristic.ConfiguredName, trackName);
          }
        } else {
          this.tvService.updateCharacteristic(this.Characteristic.ConfiguredName, this.baseName);
        }

        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0
        );
      } catch (err) {}
    }, interval);
  }
}

module.exports = SpotifyAvrGroupPlatform;
