# Keygen Licensing Notes

This starter supports a Keygen-only license flow by default. The license screen asks for a license key, validates it with Keygen, creates a machine activation for the current device, and stores the activation in UXP secure storage for offline relaunches.

## Keygen Settings

```env
DOR_KEYGEN_BASE_URL="https://api.keygen.sh"
DOR_KEYGEN_ACCOUNT_ID="your-keygen-account-id"
DOR_KEYGEN_PRODUCT_ID="your-keygen-product-id"
```

Use a custom `DOR_KEYGEN_BASE_URL` if you proxy Keygen or self-host a compatible service.

## Plugin Identity

```env
DOR_UXP_PLUGIN_ID="your-plugin-id"
DOR_UXP_PLUGIN_NAME="Your Plugin Name"
DOR_UXP_PANEL_LABEL="Your Plugin Name"
DOR_LICENSE_V2_PLUGIN_ID="your-plugin-id"
PLUGIN_VERSION="1.0.0"
DOR_LOCAL_VERSION="1.0.0"
```

The webpack build uses these values to fill `dist/manifest.json` and to identify update/license requests.

## Local Development

To bypass the license screen while building your plugin UI:

```bash
npm run build:dev:unlocked
npm run watch:unlocked
```

Do not use the unlocked build for release candidates or production builds.

## Release Verification

Before distributing a build, verify:

1. Fresh activation with a valid license key.
2. Rejected activation with an invalid key.
3. Offline relaunch after a successful activation.
4. Clear License removes local activation and deactivates the Keygen machine.
5. The unlocked workspace appears only after activation when `DOR_LICENSE_ENABLED=true`.
