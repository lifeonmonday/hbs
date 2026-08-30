const TriggerClient = require('../trigger');

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
    const accessory = new this.api.platformAccessory(this.displayName, uuid, 34); // Audio Receiver

    const accessoryInfo = accessory.getService(this.Service.AccessoryInformation);
    accessoryInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Cast Group')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '12345678');

    // 1. Primary Television Service
    this.tvService = accessory.addService(this.Service.Television, this.displayName, 'avr_main');
    this.tvService.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, this.displayName);
    this.tvService.setCharacteristic(this.Characteristic.ActiveIdentifier, 0);
    // Play/Pause Logic
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isPlaying ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const shouldPlay = value === this.Characteristic.Active.ACTIVE;
        if (shouldPlay) {
          try { await this.spotifyClient.play(this.config.deviceId); this.isPlaying = true; }
          catch (err) { await this.triggerClient.triggerWakeupSwitch(); this.isPlaying = true; }
        } else {
          await this.spotifyClient.pause(this.config.deviceId); this.isPlaying = false;
        }
      });

    // 2. Speaker (for Hardware Buttons)
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, 'Volume Control', 'avr_speaker');
    this.speakerService.setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);
    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (val) => { await this.spotifyClient.setVolume(val, this.config.deviceId); this.currentVolume = val; });

    // 3. WindowCovering Service (The "Volume Slider" Hack)
    this.volumeService = accessory.addService(this.Service.WindowCovering, 'Volume', 'vol_covering');
    
    // Explicitly tell HomeKit this service does not contribute to the "Active" status of the tile
    this.volumeService.addCharacteristic(this.Characteristic.StatusActive);
    this.volumeService.setCharacteristic(this.Characteristic.StatusActive, false);
    
    this.volumeService.getCharacteristic(this.Characteristic.CurrentPosition)
      .onGet(() => this.currentVolume);

    this.volumeService.getCharacteristic(this.Characteristic.TargetPosition)
      .onGet(() => this.currentVolume)
      .onSet(async (val) => {
        await this.spotifyClient.setVolume(val, this.config.deviceId);
        this.currentVolume = val;
        this.volumeService.updateCharacteristic(this.Characteristic.CurrentPosition, val);
      });

    this.volumeService.setCharacteristic(this.Characteristic.PositionState, this.Characteristic.PositionState.STOPPED);

    this.tvService.addLinkedService(this.volumeService);

    // 3. Lightbulb (The Visible Slider)
//    this.lightbulbService = accessory.addService(this.Service.Lightbulb, 'Volume Slider', 'vol_slider');

    // Add 'On' characteristic and force it to 'true' so the slider is always accessible
    // this.lightbulbService.getCharacteristic(this.Characteristic.On)
    //  .onGet(() => true)
    //  .onSet(async (val) => {
        // Optional: If you click the slider "off", do nothing or pause playback
    //    if (!val) await this.spotifyClient.pause(this.config.deviceId);
    //  });

//    this.lightbulbService.getCharacteristic(this.Characteristic.Brightness)
//      .setProps({ minValue: 0, maxValue: 100, minStep: 5 })
//      .onGet(() => this.currentVolume)
//      .onSet(async (val) => {
//        await this.spotifyClient.setVolume(val, this.config.deviceId);
//        this.currentVolume = val;
//      });
//


    // 4. Input Source
    this.trackInputService = accessory.addService(this.Service.InputSource, 'track_display', 'Track Display');
    this.trackInputService
      .setCharacteristic(this.Characteristic.Identifier, 0)
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Spotify')
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION)
      .setCharacteristic(this.Characteristic.InputDeviceType, this.Characteristic.InputDeviceType.AUDIO_SYSTEM);

    this.tvService.addLinkedService(this.speakerService);
//    this.tvService.addLinkedService(this.lightbulbService);
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
           // Update the hidden Speaker service
           this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
           this.speakerService.updateCharacteristic(this.Characteristic.Mute, this.currentVolume === 0);

           // Update the WindowCovering slider
           this.volumeService.updateCharacteristic(this.Characteristic.CurrentPosition, this.currentVolume);
           this.volumeService.updateCharacteristic(this.Characteristic.TargetPosition, this.currentVolume);
         }

         // Track display logic...
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
         if (this.pollErrorCount > 10) { this.stopPolling(); }
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

module.exports = MultiDeviceAccessory;
