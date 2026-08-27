const TriggerClient = require('../trigger');

/**
 * Audio Receiver Accessory Implementation
 * Uses HomeKit Television service (category AUDIO_RECEIVER) with track display
 * as an input source and native volume slider in TelevisionSpeaker for 3rd-party apps (Eve, Controller).
 */
class AudioReceiverAccessory {
  constructor(log, config, api, spotifyClient) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.spotifyClient = spotifyClient;
    this.triggerClient = new TriggerClient(config, log);

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.displayName = config.name || 'Spotify Audio Receiver';
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
   * Setup and configure the Audio Receiver accessory
   */
  setupAccessory() {
    const uuid = this.api.hap.uuid.generate(`spotify-avr-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 34);

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Audio Receiver')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    this.tvService = accessory.addService(this.Service.Television, this.displayName, 'avr_main');
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    if (!this.tvService.getCharacteristic(this.Characteristic.ConfiguredName).value) {
      this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, this.displayName);
    }

    // Play/Pause via Active characteristic
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const shouldPlay = value === this.Characteristic.Active.ACTIVE;

        if (shouldPlay) {
          try {
            await this.spotifyClient.play(this.config.deviceId);
            this.isPlaying = true;
          } catch (err) {
            this.log.warn('Direct play failed (device likely idle/asleep), firing wake-up trigger...');
            try {
              await this.triggerClient.triggerWakeupSwitch();
              this.isPlaying = true; // Mark active while speaker boots and trigger starts playback
            } catch (triggerErr) {
              this.log.error('Wake-up trigger failed:', triggerErr.message);
              this.isPlaying = false;
            }
          }
        } else {
          try {
            await this.spotifyClient.pause(this.config.deviceId);
            this.isPlaying = false;
          } catch (err) {
            this.log.error('Pause command failed:', err.message);
          }
        }
      });

    // Speaker service with Volume and Mute for 3rd-party apps (Eve, Controller, etc.)
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, `${this.displayName} Volume`, 'avr_speaker');
    this.speakerService
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

    // Volume characteristic (0-100 slider in Eve / Controller)
    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.spotifyClient.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume adjustment error:', err.message);
        }
      });

    // Mute characteristic
    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => this.currentVolume === 0)
      .onSet(async (muted) => {
        try {
          const targetVol = muted ? 0 : (this.currentVolume || 30);
          await this.spotifyClient.setVolume(targetVol, this.config.deviceId);
        } catch (err) {
          this.log.error('Mute toggle error:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // Input source: Track display
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Spotify')
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    this.tvService.addLinkedService(this.trackInputService);

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
          if (this.currentTrack !== 'Not Playing') {
            this.currentTrack = 'Not Playing';
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Not Playing');
          }
          return;
        }

        this.isPlaying = state.is_playing;
        this.tvService.updateCharacteristic(
          this.Characteristic.Active,
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );

        if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          this.speakerService.updateCharacteristic(this.Characteristic.Mute, this.currentVolume === 0);
        }

        // Update track display in input source with all artists
        if (state.is_playing && state.item && state.item.artists && state.item.artists.length > 0) {
          const artistNames = state.item.artists.map((a) => a.name).join(', ');
          const trackText = `${state.item.name} · ${artistNames}`;
          if (this.currentTrack !== trackText) {
            this.currentTrack = trackText;
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, trackText);
          }
        } else {
          if (this.currentTrack !== 'Playing') {
            this.currentTrack = 'Playing';
            this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, 'Playing');
          }
        }

        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);
        this.pollErrorCount = 0;
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

module.exports = AudioReceiverAccessory;
