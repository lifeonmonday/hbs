const sinricWake = require('./sinricWake');

/**
 * Transfers Spotify playback, catching 404/NO_ACTIVE_DEVICE to fire the Sinric wake routine.
 */
async function safeTransferPlayback(spotifyApi, deviceId, log) {
  try {
    log.info(`[Spotify] Transferring playback to device: ${deviceId}`);
    await spotifyApi.transferMyPlayback([deviceId], { play: true });
    log.info('[Spotify] Playback transferred successfully.');
  } catch (err) {
    const isNotFound = err.statusCode === 404 || 
      (err.body && err.body.error && err.body.error.reason === 'NO_ACTIVE_DEVICE');

    if (isNotFound) {
      log.warn('[Spotify] Target device inactive (404 / NO_ACTIVE_DEVICE). Triggering Sinric wake...');
      await sinricWake.triggerWake(log);
    } else {
      log.error('[Spotify] API Error:', err.message);
      throw err;
    }
  }
}

module.exports = { safeTransferPlayback };