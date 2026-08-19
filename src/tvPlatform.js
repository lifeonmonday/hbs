const SpotifyClient = require('./spotify');

class SpotifyTVPlatform {
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
        this.log.error('TV Platform auth error:', err.message);
      }
    });
  }

  registerAccessory() {
    const name = (this.config.name || 'Spotify Speaker') + ' (TV)';
    const uuid = this.api.hap.uuid.generate((this.config.deviceId || 'spotify-speaker') + '-tv');
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.category = this.api.hap.Categories.TELEVISION;

    this.setupTVService(accessory);
    this.startPolling();

    this.api.publishExternalAccessories('homebridge-spotify-smart-speaker', [accessory]);
  }

  setupTVService(accessory) {
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Spotify')
      .setCharacteristic(this.Characteristic.Model, 'Connect TV UI');

    this.tvService = accessory.addService(this.Service.Television, accessory.displayName);
    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, accessory.displayName);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // Active (Power state mapped to Play/Pause)
    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0))
      .onSet(async (value) => {
        const target = value ? this.Characteristic.TargetMediaState.PLAY : this.Characteristic.TargetMediaState.PAUSE;
        await this.setMediaState(target);
      });

    this.tvService.getCharacteristic(this.Characteristic.CurrentMediaState)
      .onGet(() => this.currentMediaState);

    this.tvService.getCharacteristic(this.Characteristic.TargetMediaState)
      .onGet(() => this.targetMediaState)
      .onSet(this.setMediaState.bind(this));

    // Speaker sub-service for TV Remote volume buttons
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
          this.log.error('Volume error:', err.message);
        }
      });

    this.tvService.addLinkedService(this.speakerService);
  }

  async setMediaState(value) {
    this.targetMediaState = value;
    try {
      if (value === this.Characteristic.TargetMediaState.PLAY) {
        await this.client.play(this.config.deviceId);
        this.currentMediaState = this.Characteristic.CurrentMediaState.PLAY;
      } else {
        await this.client.pause(this.config.deviceId);
        this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
      }
      this.updateHomeKit();
    } catch (err) {
      this.log.error('Playback toggle error:', err.message);
    }
  }

  updateHomeKit() {
    const isActive = this.currentMediaState === this.Characteristic.CurrentMediaState.PLAY ? 1 : 0;
    this.tvService.updateCharacteristic(this.Characteristic.Active, isActive);
    this.tvService.updateCharacteristic(this.Characteristic.CurrentMediaState, this.currentMediaState);
    this.tvService.updateCharacteristic(this.Characteristic.TargetMediaState, this.targetMediaState);
  }

  startPolling() {
    const interval = (this.config.pollInterval || 5) * 1000;
    setInterval(async () => {
      try {
        const state = await this.client.getPlaybackState();
        if (!state || !state.device || (this.config.deviceId && state.device.id !== this.config.deviceId)) {
          this.currentMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          this.targetMediaState = this.Characteristic.CurrentMediaState.PAUSE;
          this.updateHomeKit();
          return;
        }

        this.currentMediaState = state.is_playing
          ? this.Characteristic.CurrentMediaState.PLAY
          : this.Characteristic.CurrentMediaState.PAUSE;
        this.targetMediaState = this.currentMediaState;

        if (state.device.volume_percent !== null) {
          this.currentVolume = state.device.volume_percent;
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        }

        this.updateHomeKit();
      } catch (err) {}
    }, interval);
  }
}

module.exports = SpotifyTVPlatform;
