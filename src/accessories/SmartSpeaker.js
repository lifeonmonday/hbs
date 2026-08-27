const TriggerClient = require('../trigger');

/**
 * Smart Speaker Accessory Implementation
 * Uses HomeKit SmartSpeaker service for playback control
 */
class SmartSpeakerAccessory {
  constructor(log, config, api, spotifyClient) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.spotifyClient = spotifyClient;
    this.triggerClient = new TriggerClient(config, log);

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
    this.currentVolume = 30;

    this.pollingInterval = null;
    this.pollErrorCount = 0;
  }

  /**
   * Initialize and register the accessory
   */
  async initialize() {
    this.registerAccessory();
    this.startPolling();
  }

  /**
   * Register the accessory with HomeKit
   */
  registerAccessory() {
    const name = this.config.name || 'Spotify Speaker';
    const uuid = this.api.hap.uuid.generate(`spotify-speaker-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.SPEAKER;

    this.setupSmartSpeaker(accessory);
    this.api.publishExternalAccessories('homebridge-hbs', [accessory]);
  }

  /**
   * Configure the Smart Speaker service and characteristics
   */
  setupSmartSpeaker(accessory) {
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Smart Speaker')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '123456');

    this.speakerService = accessory.addService(this.Service.SmartSpeaker, accessory.displayName);
    this.speakerService.setCharacteristic(this.Characteristic.ConfiguredName, accessory.displayName);

    // Current Media State (read-only)
    this.speakerService.getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => this.currentMediaState);

    // Target Media State (play/pause control)
    this.speakerService.getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => this.targetMediaState)
      .onSet(async (value) => {
        this.targetMediaState = value;
        try {
          if (value === this.Characteristic.TargetMediaState.PLAY) {
            await this.spotifyClient.play(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
          } else {
            await this.spotifyClient.pause(this.config.deviceId);
            this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          }
          this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
        } catch (err) {
          this.log.error('Playback state change error:', err.message);
        }
      });

    // Volume control
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

    // Mute control
    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => false)
      .onSet(async (muted) => {
        try {
          const targetVol = muted ? 0 : (this.currentVolume || 30);
          await this.spotifyClient.setVolume(targetVol, this.config.deviceId);
        } catch (err) {
          this.log.error('Mute toggle error:', err.message);
        }
      });
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
          this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
          this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
          this.speakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
          return;
        }

        this.currentMediaState = state.is_playing
          ? this.Characteristic.CurrentMediaState.PLAY
          : this.Characteristic.CurrentMediaState.PAUSE;
        this.targetMediaState = this.currentMediaState;

        if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        }

        this.speakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
        this.speakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);

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

module.exports = SmartSpeakerAccessory;
