# UXP Vanilla Keygen Starter

This branch is a vanilla Photoshop UXP plugin starter with the Keygen/license gate wired in. After activation, the plugin opens a small "Your play area" workspace that other developers can replace with their own UI and Photoshop logic.

The starter is intentionally plain JavaScript with webpack. There is no React, Vue, or framework layer.

## Quick Start

Install dependencies once:

```bash
npm install
```

Create local env files from the example:

```bash
cp .env.example .env.development
cp .env.example .env.production
```

Build a local licensed bundle:

```bash
npm run build:dev
```

Then in Adobe UXP Developer Tool, add and load:

```text
dist/manifest.json
```

For local UI work with the license gate bypassed:

```bash
npm run build:dev:unlocked
npm run watch:unlocked
```

## Where To Build Your Plugin

| Path | Purpose |
|---|---|
| `src/main.js` | Starter app entrypoint. Add your unlocked workspace behavior here or import your modules from here. |
| `src/license/` | Keygen/license runtime, activation UI state, device fingerprinting, update checks, and secure storage. |
| `public/index.html` | Starter panel markup after the license gate unlocks. |
| `public/index.css` | Starter panel styling. |
| `public/license.html` | Activation screen markup. |
| `public/license.css` | Activation and update notice styling. |
| `public/manifest.json` | UXP manifest template. Webpack fills name/version/id from env when available. |
| `licence-webpack-plugin/` | Optional protected-call/protected-data build transforms. |

## Keygen Configuration

Set these values in `.env.development` and `.env.production`:

```env
DOR_LICENSE_ENABLED="true"
DOR_LICENSING_MODE="keygen_only"
DOR_KEYGEN_BASE_URL=""
DOR_KEYGEN_ACCOUNT_ID=""
DOR_KEYGEN_PRODUCT_ID=""
DOR_UXP_PLUGIN_ID="your-plugin-id"
DOR_UXP_PLUGIN_NAME="Your Plugin Name"
DOR_UXP_PANEL_LABEL="Your Plugin Name"
PLUGIN_VERSION="1.0.0"
DOR_LOCAL_VERSION="1.0.0"
```

Use `DOR_LICENSE_ENABLED=false` only for local development builds where you want to open the play area without activation.

## Customization Checklist

1. Update `public/manifest.json` defaults.
2. Update `.env.development` and `.env.production`.
3. Replace the starter workspace in `public/index.html`.
4. Add your plugin code from `src/main.js` or imported modules.
5. Replace `public/icons/*` with your own plugin icons.
6. Update the support links in `public/license.html`.
7. Run `npm run build:dev` and load `dist/manifest.json` in UDT.

## Release Checklist

1. Set production Keygen and update-check env values.
2. Make sure `PLUGIN_VERSION`, `DOR_LOCAL_VERSION`, and `public/manifest.json` version match.
3. Run:

```bash
npm run build:prod
```

4. Load `dist/manifest.json` in UDT.
5. Verify activation, offline relaunch, Clear License, update notice behavior, and the unlocked workspace.
6. Distribute only the generated `dist/` folder.
