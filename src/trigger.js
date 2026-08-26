class TriggerClient {
  constructor(config, log) {
    this.log = log;
    this.homebridgeUrl = config.homebridgeUrl || 'http://127.0.0.1:8581';
    this.username = config.homebridgeUsername;
    this.password = config.homebridgePassword;
    this.switchUuid = config.triggerSwitchUuid;
    
    this.cachedToken = null;
  }

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
    this.cachedToken = data.access_token;
    return this.cachedToken;
  }

  async triggerWakeupSwitch() {
    if (!this.username || !this.password || !this.switchUuid) {
      this.log.warn('Trigger skipped: missing homebridgeUsername, homebridgePassword, or triggerSwitchUuid.');
      return;
    }

    try {
      this.log.info('Waking up device via trigger switch...');
      
      let token = await this.getAuthToken();
      let url = `${this.homebridgeUrl}/api/accessories/${encodeURIComponent(this.switchUuid)}`;

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

      if (response.status === 401) {
        this.log.info('Token expired, renewing authentication...');
        this.cachedToken = null;
        token = await this.getAuthToken();

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
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      this.log.info('Wake-up trigger switch successfully turned ON.');
    } catch (err) {
      this.log.error('Failed to execute wake-up trigger:', err.message);
    }
  }
}

module.exports = TriggerClient;
