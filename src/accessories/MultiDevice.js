const TriggerClient = require('../trigger');

/**
 * Test 1: AVR + Regular Speaker Service
 * Primary: Television (AVR)
 * Linked: Regular Speaker (for Volume/Mute display) + InputSource (for Track Display)
 */
class MultiDeviceAccessory {
  constructor(log, config, api, spotifyClient) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.spotifyClient = spotifyClient;
    this.triggerClient = new TriggerClient(config, log);

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.displayName = config.name || 'Spotify MultiDevice';
    this.isPlaying = false;
    this.currentVolume = 30;
    this.currentTrack = '';

    this.pollingInterval = null;
    this.pollErrorCount = 0;
  }

  async initialize() {
    this.setupAccessory();
    this.startPolling();
  }

  setupAccessory() {
    // Category 34 (Audio Receiver)
    const uuid = this.api.hap.uuid.generate(`spotify-multi-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 34);

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Test 1: AVR + Speaker')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // 1. Primary Television Service
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
            this.log.warn('Direct play failed, firing wake-up trigger...');
            try {
              await this.triggerClient.triggerWakeupSwitch();
              this.isPlaying = true;
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

    // 2. Regular Speaker Service (NOT TelevisionSpeaker, NOT SmartSpeaker)
    this.speakerService = accessory.addService(this.Service.Speaker, `${this.displayName} Speaker`, 'avr_speaker');

    // Some Speaker services support Volume, some only Mute. Let's add both to test.
    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.spotifyClient.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume error:', err.message);
        }
      });

    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => this.currentVolume === 0)
      .onSet(async (muted) => {
        try {
          const targetVol = muted ? 0 : (this.currentVolume || 30);
          await this.spotifyClient.setVolume(targetVol, this.config.deviceId);
        } catch (err) {
          this.log.error('Mute error:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);

    // 3. Track Display Input Source
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Spotify')
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    this.tvService.addLinkedService(this.trackInputService);

    this.api.publishExternalAccessories('homebridge-hbs', [accessory]);
  }

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

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

module.exports = MultiDeviceAccessory;
