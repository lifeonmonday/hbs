const TriggerClient = require('../trigger');

/**
 * Lightbulb Accessory Implementation
 * Uses HomeKit Lightbulb service with On/Off and Brightness for volume
 */
class LightbulbAccessory {
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
    const name = `${this.config.name || 'Spotify'} Light`;
    const uuid = this.api.hap.uuid.generate(`${this.config.deviceId || 'spotify'}-lightbulb`);
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.LIGHTBULB;

    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Light')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '123456');

    this.service = accessory.addService(this.Service.Lightbulb, accessory.displayName);

    // On/Off characteristic for play/pause
    this.service.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.isPlaying)
      .onSet(async (value) => {
        try {
          if (value) {
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
            if (value) {
              await this.spotifyClient.play(this.config.deviceId);
              this.isPlaying = true;
            }
          } catch (retryErr) {
            this.log.error('Playback control failed after wake-up:', retryErr.message);
            this.isPlaying = false;
            setTimeout(() => {
              this.service.updateCharacteristic(this.Characteristic.On, false);
            }, 500);
          }
        }
      });

    // Brightness characteristic for volume control
    this.service.getCharacteristic(this.Characteristic.Brightness)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 5
      })
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.spotifyClient.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
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
          this.service.updateCharacteristic(this.Characteristic.On, false);
          return;
        }

        this.isPlaying = state.is_playing;
        this.service.updateCharacteristic(this.Characteristic.On, this.isPlaying);

        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.service.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
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

module.exports = LightbulbAccessory;
