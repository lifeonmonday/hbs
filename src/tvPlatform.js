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
    this.currentVolume = 30; // Domyślny poziom głośności
    this.currentTrack = '';
    this.baseName = this.config.name || 'Spotify Speaker';

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
    const name = `${this.baseName} AVR`;
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-avr-test');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.TELEVISION;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect AVR UI');

    // Główna usługa Television / AVR
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

    // Przechwytywanie przycisków z pilota iOS
    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(async (value) => {
        if (value === this.Characteristic.RemoteKey.PLAY_PAUSE) {
          const isPlaying = this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY;
          if (isPlaying) {
            await this.client.pause(this.config.deviceId);
          } else {
            await this.client.play(this.config.deviceId);
          }
        }
      });

    // --- Usługa Głośności (TelevisionSpeaker) ---
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
          this.syncActiveInputWithVolume(value);
        } catch (err) {
          this.log.error('Błąd głośności:', err.message);
        }
      });

    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        try {
          const step = value === this.Characteristic.VolumeSelector.INCREMENT ? 5 : -5;
          const newVol = Math.min(100, Math.max(0, this.currentVolume + step));
          await this.client.setVolume(newVol, this.config.deviceId);
          this.currentVolume = newVol;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          this.syncActiveInputWithVolume(newVol);
        } catch (err) {
          this.log.error('Błąd przycisków głośności:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // --- Tworzenie źródeł głośności (InputSource: 15%, 30%, 40%) ---
    this.setupVolumeInputSources(accessory);

    this.startPolling();
    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupVolumeInputSources(accessory) {
    const levels = [
      { id: 1, name: 'Głośność 15%', vol: 15 },
      { id: 2, name: 'Głośność 30%', vol: 30 },
      { id: 3, name: 'Głośność 40%', vol: 40 }
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

    // Reakcja na wybór źródła w rozwijanej liście
    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => this.getActiveInputIdentifier(this.currentVolume))
      .onSet(async (value) => {
        const targetLevel = levels.find((l) => l.id === value);
        if (targetLevel) {
          try {
            await this.client.setVolume(targetLevel.vol, this.config.deviceId);
            this.currentVolume = targetLevel.vol;
            this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          } catch (err) {
            this.log.error('Błąd zmiany poziomu głośności z listy:', err.message);
          }
        }
      });
  }

  getActiveInputIdentifier(vol) {
    if (vol <= 20) return 1; // 15%
    if (vol <= 35) return 2; // 30%
    return 3;                // 40%
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

        // Aktualizacja głośności
        if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          this.syncActiveInputWithVolume(this.currentVolume);
        }

        // Dynamiczna aktualizacja nazwy z tytułem utworu ('Title · Artist')
        if (state.item) {
          const trackName = `${state.item.name} · ${state.item.artists.map((a) => a.name).join(', ')}`;
          if (this.currentTrack !== trackName) {
            this.currentTrack = trackName;
            this.tvService.updateCharacteristic(this.Characteristic.ConfiguredName, trackName);
          }
        } else {
          this.tvService.updateCharacteristic(this.Characteristic.ConfiguredName, `${this.baseName} AVR`);
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
