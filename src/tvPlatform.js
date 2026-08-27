const SpotifyClient = require('./spotify');
const TriggerClient = require('./trigger');

class SpotifyTvPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.baseName = this.config.name || 'Spotify';
    this.isPlaying = false;
    this.currentVolume = 30;
    this.currentTrack = '';

    // INICJALIZACJA KLIENTÓW
    this.client = new SpotifyClient(this.config, this.log);
    this.triggerClient = new TriggerClient(this.config, this.log, this);

    // Rejestracja akcesorium AVR
    this.accessory = this.setupAccessory();

    // Start pętli odpytującej w tle
    this.startPolling();
  }

  setupAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-tv-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.hap.Accessory(`${this.baseName} AVR`, uuid);

    // 1. GŁÓWNA USŁUGA TELEVISION (AVR)
    this.tvService = accessory.addService(this.Service.Television, `${this.baseName} AVR`, 'tv_main');

    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode, 
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // Ochrona nazwy: Ustawiamy tylko raz, jeśli pusta. Nie nadpisujemy zmienionej nazwy w iOS.
    if (!this.tvService.getCharacteristic(this.Characteristic.ConfiguredName).value) {
      this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, `${this.baseName} AVR`);
    }

    // Obsługa Play / Pause (Active)
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const shouldPlay = (value === this.Characteristic.Active.ACTIVE);
        
        if (shouldPlay) {
          try {
            await this.client.play(this.config.deviceId);
            this.isPlaying = true;
          } catch (err) {
            this.log.warn('Direct play failed, attempting wake-up trigger...');
            try {
              await this.triggerClient.triggerWakeupSwitch();
              await this.client.play(this.config.deviceId);
              this.isPlaying = true;
            } catch (retryErr) {
              this.log.error('Playback failed after wake-up:', retryErr.message);
              this.isPlaying = false;
              
              // Self-healing: cofnięcie kafelka w Apple Home po porażce
              setTimeout(() => {
                this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
              }, 500);
            }
          }
        } else {
          try {
            await this.client.pause(this.config.deviceId);
            this.isPlaying = false;
          } catch (err) {
            this.log.error('Error pausing Spotify:', err.message);
          }
        }
      });

    // 2. TELEVISION SPEAKER (Boczne przyciski głośności w iPhonie)
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, 'Volume Control', 'tv_speaker');
    this.speakerService
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        const step = (value === this.Characteristic.VolumeSelector.INCREMENT) ? 5 : -5;
        this.currentVolume = Math.min(100, Math.max(0, this.currentVolume + step));

        try {
          await this.client.setVolume(this.currentVolume, this.config.deviceId);
          this.log.info(`Volume updated via buttons: ${this.currentVolume}%`);
        } catch (err) {
          this.log.error('Failed to change volume via buttons:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // 3. INPUT SOURCES (Wyświetlacz Utworu + Progi Głośności)

    // ID: 0 -> Wyświetlanie aktualnego utworu
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Brak odtwarzania')
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    this.tvService.addLinkedService(this.trackInputService);

    // ID: 1..4 -> Szybkie progi głośności
    const volumePresets = [
      { id: 1, name: 'Głośność: 15%', level: 15 },
      { id: 2, name: 'Głośność: 30%', level: 30 },
      { id: 3, name: 'Głośność: 45%', level: 45 },
      { id: 4, name: 'Głośność: 60%', level: 60 }
    ];

    volumePresets.forEach((preset) => {
      const inputService = accessory.addService(this.Service.InputSource, `vol_preset_${preset.id}`, preset.name);
      inputService
        .setCharacteristic(this.Characteristic.Identifier, preset.id)
        .setCharacteristic(this.Characteristic.ConfiguredName, preset.name)
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

      this.tvService.addLinkedService(inputService);
    });

    // Reakcja na wybór z listy wejść
    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(async (value) => {
        const selected = volumePresets.find(p => p.id === value);
        
        if (selected) {
          try {
            await this.client.setVolume(selected.level, this.config.deviceId);
            this.currentVolume = selected.level;
            this.log.info(`Volume preset selected: ${selected.level}%`);
          } catch (err) {
            this.log.error('Failed to set preset volume:', err.message);
          }
        }

        // Zawsze przywracamy zaznaczenie na pozycję utworu (ID: 0)
        setTimeout(() => {
          this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);
        }, 300);
      });

    return accessory;
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();

        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.isPlaying = false;
          this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
          this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Brak odtwarzania');
          return;
        }

        // 1. Stan odtwarzania
        this.isPlaying = state.is_playing;
        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );

        // 2. Głośność
        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
        }

        // 3. Tytuł utworu w InputSource (ID: 0)
        if (state.item) {
          const trackText = `${state.item.name} · ${state.item.artists[0].name}`;
          
          if (this.currentTrack !== trackText) {
            this.currentTrack = trackText;
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, trackText);
          }
        } else {
          this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Nie odtwarzana');
        }

        // Upewniamy się, że wskaźnik na liście wskazuje na utwór
        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);

      } catch (err) {
        // Ignorujemy okazjonalne błędy sieci w tle
      }
    }, interval);
  }
}

module.exports = SpotifyTvPlatform;
