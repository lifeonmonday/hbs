class TriggerClient {
  constructor(config, log) {
    this.log = log;
    this.homebridgeUrl = config.homebridgeUrl || 'http://homebridge:8581';
    this.username = config.homebridgeUsername;
    this.password = config.homebridgePassword;
    this.switchUuid = config.triggerSwitchUuid;
    
    // Store token in memory to reuse across calls
    this.cachedToken = null;
  }

  // 1. Get token dynamically via /api/auth/login
  async getAuthToken() {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    const loginUrl = `${this.homebridgeUrl}/api/auth/login`;

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    if (!response.ok) {
      throw new Error(`Auth failed with status ${response.status}`);
    }

    const data = await response.json();
    this.cachedToken = data.access_token; // Cache it in memory
    return this.cachedToken;
  }

  // 2. Execute trigger with automatic token handling
  async triggerWakeupSwitch() {
    if (!this.username || !this.password || !this.switchUuid) {
      this.log.warn('Trigger skipped: username, password, or triggerSwitchUuid missing in config.');
      return;
    }

    try {
      this.log.info('Waking up Nest speaker via trigger switch...');
      
      let token = await this.getAuthToken();
      let url = `${this.homebridgeUrl}/api/accessories/${this.switchUuid}`;

      let response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          characteristicType: 'On',
          value: true
        })
      });

      // If token expired (401 Unauthorized), refresh token and retry ONCE
      if (response.status === 401) {
        this.log.info('Token expired, renewing authentication...');
        this.cachedToken = null; // Clear cache
        token = await this.getAuthToken(); // Fetch new token

        response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            characteristicType: 'On',
            value: true
          })
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Wait 2 seconds for Nest session to activate
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      this.log.error('Failed to execute wake-up trigger:', err.message);
    }
  }
}

module.exports = TriggerClient;
