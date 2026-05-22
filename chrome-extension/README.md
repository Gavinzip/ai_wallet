# imToken Agent Wallet Chrome Extension

This is a Manifest V3 companion extension for the wallet agent web build.

It does three real jobs:

- Uses `chrome.identity` for Google profile sign-in in the extension popup.
- Captures the active tab title, URL, visible text, forms, buttons, and links through the current `activeTab` grant.
- Opens the wallet agent web app with that page snapshot so the agent can review the page and prepare a safe intent.

It does not steal page cookies, RENAISS sessions, Privy tokens, or wallet keys. The wallet signing flow stays in the app with Token Core and user confirmation.

## Local Build

For a local UI/dev package without Google OAuth:

```bash
npm run extension:dev
```

For a real Google login package:

```bash
node scripts/ensure-chrome-extension-key.mjs
CHROME_EXTENSION_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com npm run extension:build
```

Then load `chrome-extension/dist` from `chrome://extensions` with Developer Mode enabled.

For Google OAuth, create a Google Cloud OAuth client of type Chrome Extension, use the printed extension ID as the Item ID, and set its client id as `CHROME_EXTENSION_GOOGLE_CLIENT_ID`.
