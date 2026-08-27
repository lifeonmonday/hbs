# homebridge-hbs

**Homebridge Spotify Plugin** — Control your Spotify playback from HomeKit as a Smart Speaker, TV, Lightbulb, or Fan accessory.

## Features

- 🎵 **Play/Pause Control** — Start and stop playback directly from HomeKit
- 🔊 **Volume Control** — Adjust Spotify volume via HomeKit
- 📱 **Multiple UI Types** — Choose between Smart Speaker, TV (with remote), Lightbulb, or Fan interface
- 🔄 **Real-time State Sync** — Polls Spotify API to keep HomeKit in sync
- 🚀 **Wake-up Trigger** — Optional integration with other Homebridge switches to wake devices
- ✨ **Multiple Instances** — Create multiple configs to expose the same Spotify account in different ways

## Installation

Install via Homebridge UI or npm:

```bash
npm install homebridge-hbs
```

## Configuration

### Quick Start

1. Create a Spotify Developer Application:
   - Go to https://developer.spotify.com/dashboard
   - Create a new app
   - Accept the terms and create the app
   - Get your **Client ID** and **Client Secret**

2. Set up Authorization:
   - In your Spotify app settings, add a Redirect URI: `http://127.0.0.1:8888/callback`
   - Run the plugin once with your `clientId` and `clientSecret`
   - Check the Homebridge logs for the authorization URL
   - Visit the URL, authorize the app, and get the `authCode` from the callback URL
   - Add the `authCode` to your config
   - On the next restart, the plugin will exchange it for a `refreshToken`
   - Save the `refreshToken` from the logs and remove the `authCode`

3. Find your Spotify Device ID:
   - Use Spotify CLI or a Spotify API explorer tool
   - Or add your device and check Homebridge logs for available devices

### Config Schema

```json
{
  "platforms": [
    {
      "platform": "SpotifySmartSpeaker",
      "name": "My Spotify Speaker",
      "accessoryType": "SmartSpeaker",
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "refreshToken": "YOUR_REFRESH_TOKEN",
      "deviceId": "YOUR_SPOTIFY_DEVICE_ID",
      "pollInterval": 5
    }
  ]
}
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Display name in HomeKit |
| `accessoryType` | string | Yes | `SmartSpeaker`, `TV`, `Lightbulb`, or `Fan` |
| `clientId` | string | Yes | Spotify Developer Client ID |
| `clientSecret` | string | Yes | Spotify Developer Client Secret |
| `deviceId` | string | Yes | Target Spotify Connect Device ID |
| `refreshToken` | string | Yes* | Refresh token (use `authCode` on first run) |
| `authCode` | string | No | Authorization code (first-time setup only) |
| `pollInterval` | number | No | Poll interval in seconds (default: 5) |
| `homebridgeUrl` | string | No | Homebridge API URL for wake-up triggers |
| `homebridgeUsername` | string | No | Homebridge username for triggers |
| `homebridgePassword` | string | No | Homebridge password for triggers |
| `triggerSwitchUuid` | string | No | UUID of switch to trigger for wake-up |
| `maxVolume` | number | No | Max volume limit for Fan accessory (default: 65) |

### Multiple Accessories

To expose the same Spotify account with multiple UI types, create multiple configs:

```json
{
  "platforms": [
    {
      "platform": "SpotifySmartSpeaker",
      "name": "Spotify Speaker",
      "accessoryType": "SmartSpeaker",
      "clientId": "...",
      "clientSecret": "...",
      "refreshToken": "...",
      "deviceId": "..."
    },
    {
      "platform": "SpotifySmartSpeaker",
      "name": "Spotify TV",
      "accessoryType": "TV",
      "clientId": "...",
      "clientSecret": "...",
      "refreshToken": "...",
      "deviceId": "..."
    }
  ]
}
```

## Accessory Types

### Smart Speaker
Standard media control interface with Play/Pause and Volume.

### TV (AVR)
TV-style remote with volume buttons and quick presets. Shows current track in the input list.

### Lightbulb
On/Off for play/pause, Brightness slider for volume. Compact for those who prefer minimal controls.

### Fan
Active state for play/pause, Rotation Speed for volume. Includes optional max volume limit via `maxVolume` config.

## Wake-up Trigger (Optional)

Some devices (like Nest speakers) may not respond to direct API calls if they're in sleep mode. You can set up a trigger switch to wake them:

1. Create a simple switch accessory in Homebridge
2. Add its UUID and your Homebridge credentials to the config
3. The plugin will toggle the switch before issuing playback commands

## Development

### File Structure

```
src/
  Platform.js           Main platform class
  spotify.js            Spotify API wrapper
  trigger.js            Homebridge trigger client
  accessories/
    SmartSpeaker.js     Smart Speaker UI
    TV.js               TV/AVR UI
    Lightbulb.js        Lightbulb UI
    Fan.js              Fan UI
```

### Testing

Clone this repo, make changes on the `dev` branch, then:

```bash
npm install lifeonmonday/hbs#dev
```

## License

MIT

## Support

For issues or feature requests, visit the GitHub repository.
