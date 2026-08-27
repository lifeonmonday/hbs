const TriggerClient = require('../trigger');

/**
 * TV/AVR Accessory Implementation
 * Uses HomeKit Television service with remote control and volume presets
 */
class TVAccessory {
  constructor(log, config, api, spotifyClient) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.spotifyClient = spotifyClient;
    this.triggerClient = new TriggerClient(config, log);

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.baseName = config.name || 'Spotify';
    this.isPlaying = false;
    this.currentVolume = 30;
    this.currentTrack = '';

    this.pollingInterval = null;
    this.pollErrorCount = 0;
  }

  /**
   * Initialize and register the accessory
   */
  async initialize() {
    this.setupAccessory();
    this.startPolling();
  }

  /**
   * Setup and configure the TV accessory
   */
  setupAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-tv-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(`${this.baseName} TV`, uuid, 34);

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect TV')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    this.tvService = accessory.addService(this.Service.Television, `${this.baseName} TV`, 'tv_main');
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    if (!this.tvService.getCharacteristic(this.Characteristic.ConfiguredName).value) {
      this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, `${this.baseName} TV`);
    }

    // Play/Pause via Active characteristic
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const shouldPlay = value === this.Characteristic.Active.ACTIVE;

        try {
          if (shouldPlay) {
            await this.spotifyClient.play(this.config.deviceId);
            this.isPlaying = true;
          } else {
            await this.spotifyClient.pause(this.config.deviceId);
            this.isPlaying = false;
          }
        } catch (err) {
          this.log.warn('Direct control failed, attempting wake-up trigger...');
          try {
            await this.triggerClient.triggerWakeupSwitch();
            if (shouldPlay) {
              await this.spotifyClient.play(this.config.deviceId);
              this.isPlaying = true;
            } else {
              await this.spotifyClient.pause(this.config.deviceId);
              this.isPlaying = false;
            }
          } catch (retryErr) {
            this.log.error('Playback control failed after wake-up:', retryErr.message);
            this.isPlaying = false;
            setTimeout(() => {
              this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
            }, 500);
          }
        }
      });

    // Speaker service for volume control
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, 'Volume Control', 'tv_speaker');
    this.speakerService
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        const step = value === this.Characteristic.VolumeSelector.INCREMENT ? 5 : -5;
        this.currentVolume = Math.min(100, Math.max(0, this.currentVolume + step));

        try {
          await this.spotifyClient.setVolume(this.currentVolume, this.config.deviceId);
          this.log.info(`Volume updated via buttons: ${this.currentVolume}%`);
        } catch (err) {
          this.log.error('Failed to change volume via buttons:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // Input sources: Track display + volume presets
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'No playback')
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    this.tvService.addLinkedService(this.trackInputService);

    // Volume presets
    const volumePresets = [
      { id: 1, name: 'Volume: 15%', level: 15 },
      { id: 2, name: 'Volume: 30%', level: 30 },
      { id: 3, name: 'Volume: 45%', level: 45 },
      { id: 4, name: 'Volume: 60%', level: 60 }
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

    // Handle preset selection
    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(async (value) => {
        const selected = volumePresets.find(p => p.id === value);

        if (selected) {
          try {
            await this.spotifyClient.setVolume(selected.level, this.config.deviceId);
            this.currentVolume = selected.level;
            this.log.info(`Volume preset selected: ${selected.level}%`);
          } catch (err) {
            this.log.error('Failed to set preset volume:', err.message);
          }
        }

        setTimeout(() => {
          this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);
        }, 300);
      });

    this.api.publishExternalAccessories('homebridge-hbs', [accessory]);
  }

  /**
   * Start polling for playback state changes
   */
  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    this.pollingInterval = setInterval(async () => {
      try {
        const state = await this.spotifyClient.getPlaybackState();

        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.isPlaying = false;
          this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
          this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'No playback');
          return;
        }

        this.isPlaying = state.is_playing;
        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );

        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
        }

        if (state.item) {
          const trackText = `${state.item.name} · ${state.item.artists[0].name}`;
          if (this.currentTrack !== trackText) {
            this.currentTrack = trackText;
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, trackText);
          }
        } else {
          this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Not playing');
        }

        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);
        this.pollErrorCount = 0; // Reset error counter on success
      } catch (err) {
        this.log.warn(`Polling error: ${err.message}`);
        this.pollErrorCount++;
        if (this.pollErrorCount > 10) {
          this.log.error('Stopping polling after repeated errors');
          this.stopPolling();
        }
      }
    }, interval);
  }

  /**
   * Stop the polling interval
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

module.exports = TVAccessory;
