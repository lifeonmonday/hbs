class TriggerClient {
  constructor(config, log, platform) {
    this.log = log;
    this.platform = platform; // Instancja platformy przekazana z głównego pliku wtyczki
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
    // 1. METODA OBECNA (HTTP API UI X)
    if (this.username && this.password && this.switchUuid) {
      try {
        this.log.info('Waking up device via HTTP API trigger switch...');
        
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

        this.log.info('Wake-up trigger switch successfully turned ON via HTTP API.');
      } catch (err) {
        this.log.error('Failed to execute HTTP wake-up trigger:', err.message);
      }
    }

    // ====================================================================
    // TEST: BEZPOŚREDNIE WYWOŁANIE "Local Trigger" W PAMIĘCI RAM
    // ====================================================================
    try {
      this.log.info('[TEST] Próba włączenia "Local Trigger" bezpośrednio w pamięci RAM Homebridge...');

      if (!this.platform || !this.platform.accessories) {
        this.log.warn('[TEST FAILED] Brak dostępu do tablicy platform.accessories (brak przekazanego platform w constructor).');
      } else {
        // Szukamy akcesorium w pamięci po nazwie "Local Trigger" lub numerze seryjnym
        const targetAccessory = this.platform.accessories.find(acc => {
          const nameMatches = acc.displayName === 'Local Trigger';
          
          let serialMatches = false;
          if (acc.getService && this.platform.api?.hap) {
            const infoService = acc.getService(this.platform.api.hap.Service.AccessoryInformation);
            const serialChar = infoService?.getCharacteristic(this.platform.api.hap.Characteristic.SerialNumber);
            if (serialChar?.value === 'a79ef4af-0f15-4c4f-96ce-ae11f05fd9d6') {
              serialMatches = true;
            }
          }

          return nameMatches || serialMatches;
        });

        if (!targetAccessory) {
          this.log.warn('[TEST FAILED] Nie znaleziono akcesorium "Local Trigger" w pamięci RAM Homebridge.');
        } else {
          // Pobieramy serwis przełącznika (Switch)
          const switchService = targetAccessory.getService('Switch') || 
                                (this.platform.api?.hap && targetAccessory.getService(this.platform.api.hap.Service.Switch));
          
          if (switchService) {
            // Włączamy cechę ON bezpośrednio w silniku HAP
            const onCharacteristic = switchService.getCharacteristic(this.platform.api.hap.Characteristic.On) || 
                                     switchService.getCharacteristic('On');
            
            onCharacteristic.setValue(true);
            this.log.info('[TEST SUCCESS] Przełącznik "Local Trigger" aktywowany natywnie w pamięci RAM!');
          } else {
            this.log.warn('[TEST FAILED] Znaleziono akcesorium, ale brak w nim serwisu Switch.');
          }
        }
      }
    } catch (testErr) {
      this.log.error('[TEST ERROR] Błąd podczas bezpośredniej zmiany w pamięci:', testErr.message);
    }
    // ====================================================================
  }
}

module.exports = TriggerClient;
