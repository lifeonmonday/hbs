const TriggerClient = require('../trigger');

/**
 * Test 2: Smart Speaker + Lightbulb (for Volume)
 * Primary: SmartSpeaker
 * Linked: Lightbulb (mapped to Volume)
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

    this.pollingInterval = null;
  }

  async initialize() {
    this.setupAccessory();
    this.startPolling();
  }

  setupAccessory() {
    // New UUID to force HomeKit to re-scan as a new device
    const uuid = this.api.hap.uuid.generate(`spotify-multi-test2-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 35); // 35: Speaker Category

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Test 2: Smart Speaker + Lightbulb')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // 1. Primary SmartSpeaker Service
    this.smartSpeakerService = accessory.addService(this.Service.SmartSpeaker, this.displayName, 'smart_speaker');
    this.smartSpeakerService
      .getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => (this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE));

    this.smartSpeakerService
      .getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => (this.isPlaying ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE))
      .onSet(async (value) => {
        const shouldPlay = value === this.Characteristic.TargetMediaState.PLAY;
        try {
          if (shouldPlay) {
            await this.spotifyClient.play(this.config.deviceId);
            this.isPlaying = true;
          } else {
            await this.spotifyClient.pause(this.config.deviceId);
            this.isPlaying = false;
          }
          this.smartSpeakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE);
        } catch (err) {
          this.log.error('Playback control failed:', err.message);
        }
      });

    // 2. Lightbulb Service (Volume Control Hack)
    this.lightbulbService = accessory.addService(this.Service.Lightbulb, 'Volume', 'volume_light');
    this.lightbulbService.addCharacteristic(this.Characteristic.Brightness);

    this.lightbulbService.getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.spotifyClient.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume error:', err.message);
        }
      });

    this.smartSpeakerService.addLinkedService(this.lightbulbService);
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
          if (state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
            this.currentVolume = state.device.volume_percent;
            this.lightbulbService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
          }
        }
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.isPlaying ? this.Characteristic.CurrentMediaState.PLAY : this.Characteristic.CurrentMediaState.PAUSE);
        this.smartSpeakerService.updateCharacteristic(this.Characteristic.TargetMediaState, this.isPlaying ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE);
      } catch (err) {
        this.log.warn(`Polling error: ${err.message}`);
      }
    }, interval);
  }

  stopPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  }
}

module.exports = MultiDeviceAccessory;
