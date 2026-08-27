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

    // Inicjalizacja klientów API i budzika
    this.client = new SpotifyClient(this.config, this.log);
    this.triggerClient = new TriggerClient(this.config, this.log, this);

    // Budowanie akcesorium AVR
    this.accessory = this.setupAccessory();

    // PUBLIKACJA AKCESORIUM ZEWNĘTRZNEGO (Wymagane przez HomeKit dla TV/AVR)
    this.api.publishExternalAccessories('homebridge-spotify-tv', [this.accessory]);

    // Start odpytywania w tle
    this.startPolling();
  }

  setupAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-tv-${this.config.deviceId || 'default'}`);
    
    // Tworzymy akcesorium (typ 34 = TARGET_CATEGORY_AUDIO_RECEIVER / AVR)
    const accessory = new this.api.platformAccessory(`${this.baseName} AVR`, uuid, 34);

    // Informacje o akcesorium (Wymagane dla External Accessories)
    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect AVR')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // 1. GŁÓWNA USŁUGA TELEVISION (AVR)
    this.tvService = accessory.addService(this.Service.Television, `${this.baseName} AVR`, 'tv_main');

    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode, 
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // ConfiguredName ustawiamy tylko raz (nie nadpisuje nazwy wybranej przez użytkownika na iPhonie)
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
              
              // Cofnięcie stanu kafelka (Self-Healing UI)
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

    // ID: 0 -> Dynamiczne wyświetlanie utworu
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Brak odtwarzania')
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    this.tvService.addLinkedService(this.trackInputService);

    // ID: 1..4 -> Szybkie progi głośności na liście
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

    // Reakcja na kliknięcie na liście
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

        // Przywracamy wskaźnik zaznaczenia na nagłówek z piosenką (ID: 0)
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

        // 1. Stan Play / Pause
        this.isPlaying = state.is_playing;
        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );

        // 2. Pobranie głośności
        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
        }

        // 3. Wstawienie utworu w InputSource
        if (state.item) {
          const trackText = `${state.item.name} · ${state.item.artists[0].name}`;
          
          if (this.currentTrack !== trackText) {
            this.currentTrack = trackText;
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, trackText);
          }
        } else {
          this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Nie odtwarzana');
        }

        // Upewniamy się, że zaznaczenie w interfejsie wskazuje na utwór (ID: 0)
        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);

      } catch (err) {
        // Cichy przechwytywacz błędów w tle
      }
    }, interval);
  }
}

module.exports = SpotifyTvPlatform;
