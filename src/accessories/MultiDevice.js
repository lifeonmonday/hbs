const TriggerClient = require('../trigger');

/**
 * MultiDevice Accessory Implementation
 * Combines Television (AVR) and SmartSpeaker services for full control.
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
    const uuid = this.api.hap.uuid.generate(`spotify-multi-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 34);

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'MultiDevice')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // Television Service
    this.tvService = accessory.addService(this.Service.Television, this.displayName, 'avr_main');
    this.tvService.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

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
            await this.triggerClient.triggerWakeupSwitch();
            this.isPlaying = true;
          }
        } else {
          await this.spotifyClient.pause(this.config.deviceId);
          this.isPlaying = false;
        }
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE);
      });

    // Speaker Service
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, `${this.displayName} Volume`, 'avr_speaker');
    this.speakerService.setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        await this.spotifyClient.setVolume(value, this.config.deviceId);
        this.currentVolume = value;
      });

    // SmartSpeaker Service
    this.smartSpeakerService = accessory.addService(this.Service.SmartSpeaker, this.displayName, 'smart_speaker');
    this.smartSpeakerService
      .getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => (this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE));

    this.smartSpeakerService
      .getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => (this.isPlaying ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE))
      .onSet(async (value) => {
        const shouldPlay = value === this.Characteristic.TargetMediaState.PLAY;
        if (shouldPlay) {
            await this.spotifyClient.play(this.config.deviceId);
            this.isPlaying = true;
        } else {
            await this.spotifyClient.pause(this.config.deviceId);
            this.isPlaying = false;
        }
        this.tvService.updateCharacteristic(this.Characteristic.Active, this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE);
      });

    // Linking Services
    this.tvService.addLinkedService(this.speakerService);
    this.tvService.addLinkedService(this.smartSpeakerService);

    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService.setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Spotify')
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
        } else {
          this.isPlaying = state.is_playing;
        }

        this.tvService.updateCharacteristic(this.Characteristic.Active, this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE);
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.isPlaying ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE);
      } catch (err) {
        this.log.warn(`Polling error: ${err.message}`);
      }
    }, interval);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }
}

module.exports = MultiDeviceAccessory;
