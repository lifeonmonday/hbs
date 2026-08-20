const SinricPro = require('sinricpro').default || require('sinricpro');
const { SinricProSwitch } = SinricPro;

class SinricWakeManager {
  constructor() {
    this.mySwitch = null;
    this.initialized = false;
  }

  /**
   * Initializes Sinric Pro WebSocket connection.
   */
  async init(appKey, appSecret, deviceId, log) {
    if (this.initialized) return;

    if (!appKey || !appSecret || !deviceId) {
      log.info('[SinricPro] Wake fallback config missing; running in standard Spotify mode.');
      return;
    }

    try {
      this.mySwitch = new SinricProSwitch(deviceId);

      // Required handler by Sinric SDK
      this.mySwitch.onPowerState(async (devId, state) => {
        log.debug(`[SinricPro] Remote switch toggled: ${state ? 'ON' : 'OFF'}`);
        return true;
      });

      SinricPro.add(this.mySwitch);

      SinricPro.onConnected(() => {
        log.info('[SinricPro] Connected. Google Home wake switch is ONLINE.');
      });

      SinricPro.onDisconnected(() => {
        log.warn('[SinricPro] Disconnected. Attempting auto-reconnect...');
      });

      await SinricPro.begin({ appKey, appSecret });
      this.initialized = true;
    } catch (err) {
      log.error('[SinricPro] Failed to initialize worker:', err.message);
    }
  }

  /**
   * Sends an ON event to trigger the Google Home Routine.
   */
  async triggerWake(log) {
    if (!this.initialized || !this.mySwitch) {
      log.warn('[SinricPro] Wake triggered but Sinric Pro is not initialized.');
      return;
    }

    log.info('[SinricPro] Firing wake switch ON to execute Google Home Routine...');
    await this.mySwitch.sendPowerStateEvent(true);

    // Reset switch back to OFF after 1 second
    setTimeout(async () => {
      await this.mySwitch.sendPowerStateEvent(false);
    }, 1000);
  }
}

module.exports = new SinricWakeManager();
