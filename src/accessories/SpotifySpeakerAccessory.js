const { safeTransferPlayback } = require('../spotifyHelper');

class SpotifySpeakerAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.log = platform.log;
    this.spotifyApi = platform.spotifyApi;
    this.deviceId = accessory.context.device.id || platform.config.spotifyDeviceId;

    this.service = this.accessory.getService(this.platform.Service.Speaker) ||
      this.accessory.addService(this.platform.Service.Speaker, accessory.displayName);

    // Register On/Off characteristic handler
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this));
  }

  async setOn(value) {
    if (value) {
      this.log.info(`[Speaker Accessory] Powering ON -> Transferring playback...`);
      await safeTransferPlayback(this.spotifyApi, this.deviceId, this.log);
    } else {
      this.log.info(`[Speaker Accessory] Powering OFF -> Pausing playback...`);
      try {
        await this.spotifyApi.pause();
      } catch (err) {
        this.log.error('[Speaker Accessory] Error pausing Spotify:', err.message);
      }
    }
  }
}

module.exports = SpotifySpeakerAccessory;
