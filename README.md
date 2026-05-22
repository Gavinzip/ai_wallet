# imToken Agent Wallet

Expo Router prototype for the Token Core wallet hackathon flow.

## What is implemented

- Wallet home screen styled after the provided reference: balance, actions, token list, animated bottom dock.
- Agent chat surface where enabled skills can be invoked.
- Server-side Agent chat that returns text plus a structured wallet intent.
- Skill registry with built-in/imported skills and a user-defined skill form.
- RENAISS Auto-Buy skill model: price trigger, source wallet, embedded trading wallet, transfer intent, Permit2 review, and execution steps.
- Token Core adapter boundary under `src/services/token-core/`.
- Safety policy under `src/security/`: exact approvals, full address display, Permit2 vs login distinction, and block path for unlimited approvals.

## Token Core integration note

Expo Go cannot load Token Core's custom native bridge. Token Core's React Native example is a native bridge around `NativeModules.TcxApi.callTcxApi(hexPayload)`. Until that native module is present, the app shows no wallet address, balance, or transaction ability instead of showing placeholder data.

Native reference inspected:

```text
token-core/tcx-examples/RN/src/native/index.ts
```

## Run

```sh
npm install
npm run agent:server
npm run web -- --port 8081
```

Open:

```text
http://localhost:8081
```

## Zeabur Docker deployment

This repo includes a `Dockerfile` for Zeabur. The image builds the Expo web
export, then runs one Node service that serves both the static wallet UI and
the `/api/*` agent endpoints from the same origin.

Required Zeabur environment variables:

```sh
MINIMAX_API_KEY=...
BITREFILL_API_KEY=...
GOOGLE_CLIENT_ID=... # Web application OAuth client id
RENAISS_MONITOR_API_URL=https://renaissmon.zeabur.app
WEB_WALLET_BACKUP_DIR=/data/web-wallet-backups
RENAISS_SCAN_CACHE_PATH=/data/renaiss-scan-cache.json
```

Recommended:

```sh
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
HOLESKY_RPC_URL=https://holesky.drpc.org
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Create a persistent Zeabur volume mounted at `/data`; otherwise encrypted web
wallet cloud backups and RENAISS scan cache can disappear on redeploy. Add the
deployed Zeabur HTTPS origin to Google Cloud OAuth Authorized JavaScript
origins.

Expo Go:

```sh
npm start
```

## Checks

```sh
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform web
```

## Puffer network modes

The Puffer mini app has a Mainnet/Testnet switch. Mainnet uses Ethereum
Mainnet; Testnet uses Ethereum Holesky because the installed Puffer SDK exposes
`PufferVault`, `PufferDepositor`, and `pufETH` on Holesky, not Sepolia. Sepolia
ETH cannot be used for the real Puffer deposit flow.

Optional RPC overrides:

```sh
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
HOLESKY_RPC_URL=https://holesky.drpc.org
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
EXPO_PUBLIC_ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
EXPO_PUBLIC_HOLESKY_RPC_URL=https://holesky.drpc.org
EXPO_PUBLIC_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

## RENAISS headless SIWE check

Run the direct API login diagnostic without opening the RENAISS page:

```sh
npm run renaiss:login-check
```

By default this creates an ephemeral Token Core EVM wallet, requests
`/api/auth/siwe/nonce`, signs the SIWE message with Token Core
`PersonalSign`, verifies it through `/api/auth/siwe/verify`, then confirms
`/api/auth/get-session` returns a session cookie. To test a specific recovery
phrase locally, set `RENAISS_TEST_MNEMONIC`; do not pass private keys or
session cookies to the script.

The agent server also exposes a local session preparation endpoint:

```sh
curl -X POST http://localhost:8787/api/renaiss/session/headless-login
```

It returns only wallet/session metadata and cookie names. Cookie values remain
inside the local agent server for the later buyNow flow.

## Agent chat and intent flow

Put the MiniMax key in server environment variables, not in the app bundle:

```sh
cp .env.example .env
MINIMAX_API_KEY=your_key npm run agent:server
```

The mobile/web app calls `EXPO_PUBLIC_AGENT_API_URL` and never receives the MiniMax API key.

## Web app first

Web wallet creation uses Google Identity Services for the user profile, WebAuthn Passkey PRF for local unlock, and Token Core WASM for keystore/account/signing.

Use the web app as the primary user-facing surface first. Chrome Extension support is optional and can be completed later.

Create a Google OAuth client of type `Web application`, then add every web origin that will run the app:

```text
http://localhost:8081
http://127.0.0.1:8081
https://your-production-domain.com
```

Do not include routes such as `/agent`; Google wants the origin only.

Add the web OAuth client id to `.env`:

```sh
GOOGLE_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
```

or bundle it through Expo:

```sh
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
```

The agent server exposes only this public client id at `GET /api/config`. It does not expose MiniMax keys, wallet keys, cookies, or session tokens.

For public use, publish the OAuth consent screen to Production or add testers while it is still in Testing mode. If Google returns `invalid_client`, `origin_mismatch`, or `no registered origin`, the OAuth client is missing the exact origin currently shown in the browser address bar.

## Web wallet backup and deployment safety

The web wallet stores the active Token Core `keystoreJson` and passkey
`credentialId` in browser storage. If a user clears site data before backing up,
the app can no longer know which encrypted keystore/passkey credential to use.
Use one of these recovery paths before putting funds in the wallet:

- Export an encrypted backup JSON from the wallet screen.
- Save an encrypted cloud backup. The server verifies the Google bearer token,
  then stores only the encrypted Token Core keystore backup under
  `WEB_WALLET_BACKUP_DIR`. It does not store Google tokens, passkey PRF keys,
  mnemonics, private keys, RENAISS cookies, Bitrefill keys, or MiniMax keys.
  On production hosting, point `WEB_WALLET_BACKUP_DIR` at a persistent volume;
  an ephemeral container filesystem will lose backups on redeploy.
- Show and store the recovery phrase offline. This is private-key-level access.

Public deployment checklist:

- Serve the web build over HTTPS. For `scripts/serve-web-export.mjs`, set
  `ENFORCE_HTTPS=1` behind a proxy that sends `X-Forwarded-Proto`; localhost is
  intentionally not redirected.
- Keep API keys and session cookies server-side only. The app calls the local
  agent API and never receives MiniMax, Bitrefill, RENAISS session cookies, or
  wallet secrets.
- Keep the static export server CSP enabled. It allows the app bundle, Token
  Core WASM, Google Identity Services, Google userinfo, and the configured agent
  API only.
- Lock deployment permissions and build from a fixed repository/commit.
- Wallet intents must show chain, recipient/to, value, calldata, spender,
  router/contract/vault, and dApp URL when present.
- Important transactions are intents only until the user confirms local Token
  Core signing on their device.

## Chrome extension companion, optional

Build a local extension package:

```sh
npm run extension:dev
```

For real extension Google login, create a separate OAuth client of type Chrome Extension and set:

```sh
CHROME_EXTENSION_GOOGLE_CLIENT_ID=your-extension-oauth-client-id.apps.googleusercontent.com
npm run extension:build
```

Load `chrome-extension/dist` in `chrome://extensions`. The extension captures active page metadata and opens the agent review; signing still stays inside Token Core.

The AI server can only return:

```json
{
  "message": "assistant text",
  "intent": null
}
```

or a wallet intent that always has:

```json
{
  "serverCanExecute": false,
  "requiresUserConfirmation": true,
  "requiresLocalSignature": true
}
```

The app shows the intent review card. The only signing entrypoint is the local Token Core adapter.
