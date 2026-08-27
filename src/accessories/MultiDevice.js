const TriggerClient = require('../trigger');

/**
 * Test 3: The Hybrid Pro Setup
 * Primary: Television (AVR)
 * Linked: TelevisionSpeaker (for Hardware Buttons) + Lightbulb (for Visible Slider) + InputSource (for Track Display)
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
  }

  async initialize() {
    this.setupAccessory();
    this.startPolling();
  }

  setupAccessory() {
    // New UUID for Test 3
    const uuid = this.api.hap.uuid.generate(`spotify-multi-test3-${this.config.deviceId || 'default'}`);
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 34); // 34: Audio Receiver

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Test 3: Hybrid Pro')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // 1. Primary Television Service
    this.tvService = accessory.addService(this.Service.Television, this.displayName, 'avr_main');
    this.tvService.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // 2. TelevisionSpeaker (For hardware buttons support)
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, 'System Volume', 'avr_speaker');
    this.speakerService.setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        await this.spotifyClient.setVolume(value, this.config.deviceId);
        this.currentVolume = value;
      });

    // 3. Lightbulb Service (The Visible Slider Hack)
    this.lightbulbService = accessory.addService(this.Service.Lightbulb, 'Volume', 'volume_slider');
    this.lightbulbService.addCharacteristic(this.Characteristic.Brightness);
    this.lightbulbService.getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        await this.spotifyClient.setVolume(value, this.config.deviceId);
        this.currentVolume = value;
      });

    // 4. InputSource (The Now Playing display)
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService.setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Spotify')
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION);

    // Link everything
    this.tvService.addLinkedService(this.speakerService);
    this.tvService.addLinkedService(this.lightbulbService);
    this.tvService.addLinkedService(this.trackInputService);

    this.api.publishExternalAccessories('homebridge-hbs', [accessory]);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;
    this.pollingInterval = setInterval(async () => {
      try {
        const state = await this.spotifyClient.getPlaybackState();
        if (state && state.device) {
          this.isPlaying = state.is_playing;
          this.currentVolume = state.device.volume_percent;

          this.tvService.updateCharacteristic(this.Characteristic.Active, this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          this.lightbulbService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);

          if (state.is_playing && state.item) {
             const trackText = `${state.item.name}`;
             this.trackInputService.updateCharacteristic(this.Characteristic.ConfiguredName, trackText);
          }
        }
      } catch (err) { /* error handling */ }
    }, interval);
  }

  stopPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  }
}

module.exports = MultiDeviceAccessory;
