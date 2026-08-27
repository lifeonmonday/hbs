const SpotifyClient = require('./spotify');
const SmartSpeakerAccessory = require('./accessories/SmartSpeaker');
const AudioReceiverAccessory = require('./accessories/AudioReceiver');

/**
 * Main Spotify Platform for Homebridge
 * Supports multiple accessories with shared credentials and Spotify API client
 */
class SpotifyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = [];

    // Map accessory types to their implementation classes
    this.accessoryClasses = {
      'SmartSpeaker': SmartSpeakerAccessory,
      'AudioReceiver': AudioReceiverAccessory
    };

    this.api.on('didFinishLaunching', async () => this.initialize());
  }

  /**
   * Initialize the platform and all configured accessories
   */
  async initialize() {
    try {
      this.validateConfig();

      // Initialize single shared Spotify client
      const spotifyClient = new SpotifyClient(this.config, this.log);
      await spotifyClient.initializeAuth();

      // Support either an accessories array or a legacy single root-level accessory
      const accessoryConfigs = Array.isArray(this.config.accessories) && this.config.accessories.length > 0
        ? this.config.accessories
        : (this.config.deviceId ? [this.config] : []);

      if (accessoryConfigs.length === 0) {
        this.log.warn('No accessories configured for SpotifyHBS platform.');
        return;
      }

      for (const accConfig of accessoryConfigs) {
        const mergedConfig = {
          ...this.config, // Global defaults (clientId, clientSecret, refreshToken, homebridgeUrl, etc.)
          ...accConfig    // Specific overrides (name, accessoryType, deviceId, triggerSwitchUuid, pollInterval)
        };

        if (!mergedConfig.deviceId) {
          this.log.error(`Accessory "${mergedConfig.name || 'Unnamed'}" is missing required "deviceId". Skipping.`);
          continue;
        }

        const accessoryType = mergedConfig.accessoryType || 'SmartSpeaker';
        const AccessoryClass = this.accessoryClasses[accessoryType];

        if (!AccessoryClass) {
          this.log.error(`Unknown accessory type: "${accessoryType}" for "${mergedConfig.name}". Must be one of: ${Object.keys(this.accessoryClasses).join(', ')}`);
          continue;
        }

        const accessoryInstance = new AccessoryClass(this.log, mergedConfig, this.api, spotifyClient);
        await accessoryInstance.initialize();
        this.accessories.push(accessoryInstance);

        this.log.info(`Initialized ${accessoryType} accessory: "${mergedConfig.name || 'Spotify'}" (Device ID: ${mergedConfig.deviceId})`);
      }
    } catch (err) {
      this.log.error('Failed to initialize platform:', err.message);
    }
  }

  /**
   * Validate required platform-level configuration fields
   */
  validateConfig() {
    const required = ['clientId', 'clientSecret'];
    const missing = required.filter(field => !this.config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required platform config fields: ${missing.join(', ')}`);
    }

    if (!this.config.authCode && !this.config.refreshToken) {
      throw new Error('Missing required: either authCode (for initial setup) or refreshToken (for existing auth)');
    }
  }
}

module.exports = SpotifyPlatform;
