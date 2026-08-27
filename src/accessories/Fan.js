const TriggerClient = require('../trigger');

/**
 * Fan Accessory Implementation
 * Uses HomeKit Fan service with On/Off and RotationSpeed for volume control
 */
class FanAccessory {
  constructor(log, config, api, spotifyClient) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.spotifyClient = spotifyClient;
    this.triggerClient = new TriggerClient(config, log);

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.isPlaying = false;
    this.currentVolume = 30;
    this.maxVolumeLimit = config.maxVolume || 65;

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
    const name = `${this.config.name || 'Spotify'} Fan`;
    const uuid = this.api.hap.uuid.generate(`${this.config.deviceId || 'spotify'}-fan`);
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.FAN;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Fan')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '123456');

    this.service = accessory.addService(this.Service.Fanv2, accessory.displayName);

    // Active characteristic for play/pause
    this.service.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const isActive = value === this.Characteristic.Active.ACTIVE;

        try {
          if (isActive) {
            await this.spotifyClient.play(this.config.deviceId);
            this.isPlaying = true;
          } else {
            await this.spotifyClient.pause(this.config.deviceId);
            this.isPlaying = false;
          }
        } catch (err) {
          this.log.warn('Direct play/pause failed, attempting wake-up trigger...');
          try {
            await this.triggerClient.triggerWakeupSwitch();
            if (isActive) {
              await this.spotifyClient.play(this.config.deviceId);
              this.isPlaying = true;
            }
          } catch (retryErr) {
            this.log.error('Playback control failed after wake-up:', retryErr.message);
            this.isPlaying = false;
            setTimeout(() => {
              this.service.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
            }, 500);
          }
        }
      });

    // RotationSpeed characteristic for volume control with max limit
    this.service.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 20
      })
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        const targetVolume = Math.min(value, this.maxVolumeLimit);
        try {
          await this.spotifyClient.setVolume(targetVolume, this.config.deviceId);
          this.currentVolume = targetVolume;
        } catch (err) {
          this.log.error('Volume adjustment error:', err.message);
        }
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
          this.service.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
          return;
        }

        this.isPlaying = state.is_playing;
        this.service.updateCharacteristic(
          this.Characteristic.Active,
          this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE
        );

        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.service.updateCharacteristic(this.Characteristic.RotationSpeed, this.currentVolume);
        }

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

module.exports = FanAccessory;
