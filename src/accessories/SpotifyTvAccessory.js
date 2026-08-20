const { safeTransferPlayback } = require('../spotifyHelper');

class SpotifyTvAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.log = platform.log;
    this.spotifyApi = platform.spotifyApi;
    this.deviceId = accessory.context.device.id || platform.config.spotifyDeviceId;

    this.tvService = this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television, accessory.displayName);

    // Register Active (On/Off) state handler
    this.tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this));

    // Register ActiveIdentifier (Input Source) handler
    this.tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(this.setActiveIdentifier.bind(this));
  }

  async setActive(value) {
    if (value === this.platform.Characteristic.Active.ACTIVE) {
      this.log.info('[TV Accessory] Powered ON -> Transferring playback...');
      await safeTransferPlayback(this.spotifyApi, this.deviceId, this.log);
    } else {
      this.log.info('[TV Accessory] Powered OFF -> Pausing playback...');
      try {
        await this.spotifyApi.pause();
      } catch (err) {
        this.log.error('[TV Accessory] Error pausing Spotify:', err.message);
      }
    }
  }

  async setActiveIdentifier(inputSourceId) {
    this.log.info(`[TV Accessory] Selected Input Source: ${inputSourceId} -> Transferring playback...`);
    await safeTransferPlayback(this.spotifyApi, this.deviceId, this.log);
  }
}

module.exports = SpotifyTvAccessory;