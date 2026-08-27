const SpotifyClient = require('./spotify');
const SmartSpeakerAccessory = require('./accessories/SmartSpeaker');
const TVAccessory = require('./accessories/TV');
const LightbulbAccessory = require('./accessories/Lightbulb');
const FanAccessory = require('./accessories/Fan');

/**
 * Main Spotify Platform for Homebridge
 * Supports multiple accessory types via configuration
 */
class SpotifyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessory = null;

    // Map accessory types to their implementation classes
    this.accessoryClasses = {
      'SmartSpeaker': SmartSpeakerAccessory,
      'TV': TVAccessory,
      'Lightbulb': LightbulbAccessory,
      'Fan': FanAccessory
    };

    this.api.on('didFinishLaunching', async () => this.initialize());
  }

  /**
   * Initialize the platform and create the appropriate accessory
   */
  async initialize() {
    try {
      // Validate configuration
      this.validateConfig();

      // Initialize Spotify client (handles auth)
      const spotifyClient = new SpotifyClient(this.config, this.log);
      await spotifyClient.initializeAuth();

      // Get the appropriate accessory class based on config
      const accessoryType = this.config.accessoryType || 'SmartSpeaker';
      const AccessoryClass = this.accessoryClasses[accessoryType];

      if (!AccessoryClass) {
        throw new Error(`Unknown accessory type: ${accessoryType}. Must be one of: ${Object.keys(this.accessoryClasses).join(', ')}`);
      }

      // Create the accessory instance
      this.accessory = new AccessoryClass(this.log, this.config, this.api, spotifyClient);
      await this.accessory.initialize();

      this.log.info(`Initialized ${accessoryType} accessory for Spotify`);
    } catch (err) {
      this.log.error('Failed to initialize platform:', err.message);
    }
  }

  /**
   * Validate required configuration fields
   */
  validateConfig() {
    const required = ['clientId', 'clientSecret', 'deviceId'];
    const missing = required.filter(field => !this.config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    // Must have either authCode or refreshToken
    if (!this.config.authCode && !this.config.refreshToken) {
      throw new Error('Missing required: either authCode (for initial setup) or refreshToken (for existing auth)');
    }
  }
}

module.exports = SpotifyPlatform;
