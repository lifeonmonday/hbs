const SpotifyClient = require('./spotify');

class SpotifySmartSpeakerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.client = new SpotifyClient(config, log);

    this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
    this.targetMediaState = this.Characteristic.TargetMediaState.PAUSE;
    this.currentVolume = 50;

    this.api.on('didFinishLaunching', async () => {
      try {
        await this.client.initializeAuth();
        this.registerAccessory();
      } catch (err) {
        this.log.error('Failed to initialize Spotify client:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = this.config.name || 'Spotify Speaker';
    const uuid = this.api.hap.uuid.generate(this.config.deviceId || 'spotify-smart-speaker');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.SPEAKER;

    this.setupSpeakerAccessory(accessory);
    this.startPolling();

    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupSpeakerAccessory(accessory) {
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect Speaker')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.deviceId || '123456');

    // Smart Speaker / Television Service
    this.tvService = accessory.addService(this.Service.Television, accessory.displayName);
    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, accessory.displayName);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0))
      .onSet(async (value) => {
        const target = value ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE;
        await this.setTargetMediaState(target);
      });

    this.tvService.getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => this.currentMediaState);

    this.tvService.getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => this.targetMediaState)
      .onSet(this.setTargetMediaState.bind(this));

    // Linked Speaker Service for Volume control
    this.speakerService = accessory.addService(this.Service.TelevisionSpeaker, `${accessory.displayName} Volume`);
    this.speakerService.setCharacteristic(
      this.Characteristic.VolumeControlType,
      this.Characteristic.VolumeControlType.ABSOLUTE
    );

    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value) => {
        try {
          await this.client.setVolume(value, this.config.deviceId);
          this.currentVolume = value;
        } catch (err) {
          this.log.error('Volume adjustment error:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);
  }

  async setTargetMediaState(value) {
    this.targetMediaState = value;
    try {
      if (value === this.Characteristic.TargetMediaState.PLAY) {
        await this.client.play(this.config.deviceId);
        this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
      } else {
        await this.client.pause(this.config.deviceId);
        this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
      }

      this.tvService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
      this.tvService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
      this.tvService.updateCharacteristic(this.Characteristic.Active, this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0);
    } catch (err) {
      this.log.error('Playback state error:', err.message);
    }
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;

    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();
        if (!state || !state.device) return;

        if (state.device.id === this.config.deviceId || !this.config.deviceId) {
          this.currentMediaState = state.is_playing
            ? this.Characteristic.CurrentMediaState.PLAY
            : this.Characteristic.CurrentMediaState.PAUSE;

          this.targetMediaState = this.currentMediaState;

          if (state.device.volume_percent !== null) {
            this.currentVolume = state.device.volume_percent;
            this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          }

          this.tvService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
          this.tvService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
          this.tvService.updateCharacteristic(
            this.Characteristic.Active,
            this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0
          );
        }
      } catch (err) {
        // Silent catch during periodic sync
      }
    }, interval);
  }
}

module.exports = SpotifySmartSpeakerPlatform;
