# Rogue Hero 4

Rogue Hero 4 is a fast-paced PixiJS-backed roguelike deck action game. The project runs as a browser game during development and as a standalone Electron app for desktop play.

## Requirements

- Node.js 20 or newer
- npm

## Install

```powershell
npm install
```

## Run In A Browser

Start the local static server:

```powershell
npm run serve
```

Then open:

```text
http://127.0.0.1:8000
```

To use another port:

```powershell
node serve-static.mjs 8001
```

## Run Standalone With Electron

Install dependencies first if you have not already:

```powershell
npm install
```

Launch the desktop app directly:

```powershell
npm start
```

This uses `electron/main.js`, loads `index.html`, and starts fullscreen.

## Build A Standalone Desktop Package

Windows:

```powershell
npm run dist
```

macOS:

```powershell
npm run dist:mac
```

Linux:

```powershell
npm run dist:linux
```

Build output is written to `dist/`.

## Useful Development Commands

```powershell
npm run syntax
npm test
npm run test:smoke
npm run mp
```

- `npm run syntax` checks JavaScript module syntax.
- `npm test` runs the multiplayer smoke/desync scripts.
- `npm run test:smoke` runs the Playwright browser smoke tests.
- `npm run mp` starts the local multiplayer helper.
