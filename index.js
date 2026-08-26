const SpotifySmartSpeakerPlatform = require('./src/platform');
const SpotifyTVPlatform = require('./src/tvPlatform');
const SpotifyLightbulbPlatform = require('./src/lightbulbPlatform');

module.exports = (api) => {
  // Original Smart Speaker
  api.registerPlatform('homebridge-spotify-smart-speaker', 'SpotifySmartSpeaker', SpotifySmartSpeakerPlatform);
  
  // Test TV Device (Control Center Remote)
  api.registerPlatform('homebridge-spotify-smart-speaker', 'SpotifyTVPlatform', SpotifyTVPlatform);

  // Test Lightbulb Device (Tile Tap & Volume Slider)
  api.registerPlatform('homebridge-spotify-smart-speaker', 'SpotifyLightbulbPlatform', SpotifyLightbulbPlatform);
  
  // Test Fan Device (Tile Tap & Volume Slider)
  api.registerPlatform('SpotifyFanPlatform', SpotifyFanPlatform);
};
