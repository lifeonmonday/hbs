const dgram = require('dgram');

/**
 * Wysyła pakiet mDNS multicast na port 5353, aby wybudzić głośniki Chromecast w sieci lokalnej.
 */
function wakeChromecastDevices(log) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    // Zapytanie mDNS PTR o usługi Googlecast (_googlecast._tcp.local)
    const query = Buffer.from([
      0x00, 0x00, // Transaction ID
      0x00, 0x00, // Flags
      0x00, 0x01, // Questions (1)
      0x00, 0x00, // Answer RRs
      0x00, 0x00, // Authority RRs
      0x00, 0x00, // Additional RRs
      // _googlecast._tcp.local
      0x0b, 0x5f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x63, 0x61, 0x73, 0x74,
      0x04, 0x5f, 0x74, 0x63, 0x70,
      0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
      0x00,
      0x00, 0x0c, // Type: PTR
      0x00, 0x01  // Class: IN
    ]);

    socket.bind(() => {
      try {
        socket.setMulticastTTL(255);
        socket.send(query, 0, query.length, 5353, '224.0.0.251', (err) => {
          if (err && log) {
            log.error('Błąd wysyłania pakietu mDNS wake:', err.message);
          }
          socket.close();
          resolve();
        });
      } catch (err) {
        if (log) log.error('Błąd gniazda UDP mDNS:', err.message);
        socket.close();
        resolve();
      }
    });

    // Timeout bezpieczeństwa
    setTimeout(() => {
      try { socket.close(); } catch (e) {}
      resolve();
    }, 1000);
  });
}

module.exports = wakeChromecastDevices;
