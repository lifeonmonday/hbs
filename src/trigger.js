class TriggerClient {
  constructor(config, log) {
    this.log = log;
    this.homebridgeUrl = config.homebridgeUrl || 'http://127.0.0.1:8581';
    this.username = config.homebridgeUsername || 'admin';
    this.password = config.homebridgePassword;
    this.switchUuid = config.triggerSwitchUuid || config.triggerUniqueId;
    
    // Cache tokena w pamięci
    this.cachedToken = null;
  }

  // 1. Pobieranie tokena z /api/auth/login
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

  // 2. Wykonanie triggera z ponowieniem przy 401
  async triggerWakeupSwitch() {
    if (!this.username || !this.password || !this.switchUuid) {
      this.log.warn('Trigger skipped: username, password, or triggerSwitchUuid missing in config.');
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

      // Wygaśnięty token (401 Unauthorized) -> wyczyszczenie i jedna ponowna próba
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

      // Czas na wybudzenie sesji Spotify / głośnika
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      this.log.error('Failed to execute wake-up trigger:', err.message);
    }
  }
}

module.exports = TriggerClient;
