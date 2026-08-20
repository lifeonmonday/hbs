const SpotifyPlatform = require('./src/platform');

/**
 * Main export required by Homebridge.
 *
 * @param {object} api - Homebridge API instance
 */
module.exports = (api) => {
  api.registerPlatform(
    'homebridge-spotify-smart-speaker',
    'SpotifySmartSpeaker',
    SpotifyPlatform
  );
};