const SpotifySmartSpeakerPlatform = require('./src/platform');

module.exports = (api) => {
  api.registerPlatform(
    'homebridge-spotify-smart-speaker',
    'SpotifySmartSpeaker',
    SpotifySmartSpeakerPlatform
  );
};
