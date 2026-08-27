const SpotifyPlatform = require('./src/Platform');

module.exports = (api) => {
  api.registerPlatform('homebridge-hbs', 'SpotifySmartSpeaker', SpotifyPlatform);
};
