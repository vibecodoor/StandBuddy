# StandBuddy

A Windows tray application that reminds you to take standing breaks at regular intervals.

## Features

- **Tray icon**: Runs quietly in your system tray
- **Fullscreen break overlay**: Blocks your screen when it's time to stand
- **Health tips**: Displays a random tip during each break
- **Configurable intervals**: Set your work interval (default: 30 min) and break duration (default: 60 sec)
- **Pause/Resume**: Right-click the tray icon to pause reminders
- **Launch at login**: Optional auto-start with Windows
- **Emergency unlock**: Hold the Skip button for 5 seconds to dismiss the break early

## Download (Windows)

1. Go to the [Releases](../../releases) page
2. Download the latest `StandBuddy-x.x.x-win.zip`
3. Extract the ZIP to any folder
4. Run `StandBuddy.exe`

**Note**: Windows SmartScreen may show an "Unknown publisher" warning since the app is not code-signed. Click "More info" then "Run anyway" to proceed.

## Run from Source

Requires [Node.js](https://nodejs.org/) (v18 or later).

```bash
npm install
npm start
```

## Build

To create a release ZIP:

```bash
npm run dist:zip
```

Output: `dist/StandBuddy-x.x.x-win.zip`

## Settings & Data

User settings are stored in:

```
%APPDATA%\standbuddy\settings.json
```

On Windows, this is typically:
```
C:\Users\<YourName>\AppData\Roaming\standbuddy\settings.json
```

## License

MIT
