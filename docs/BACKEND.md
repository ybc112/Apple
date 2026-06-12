# Apple backend

This backend keeps secret operational logic out of the browser.

## What it does

- Watches the configured Factory for new projects.
- Queues BscScan verification for each new project Token and Vault.
- Exposes a vanity salt API for fixed token address suffixes such as `aaaa`.

## Run

```bash
npm install
npm run contracts:compile
npm run backend
```

Required environment:

```bash
BSC_RPC_URL=https://bsc.publicnode.com
BSCSCAN_API_KEY=your_bscscan_key
FACTORY_ADDRESS=0xaF8Cf01201077D347351b672ebb6C66cACF9e44a
APPLE_BACKEND_PORT=8787
AUTO_VERIFY_PROJECTS=true
APPLE_CORS_ORIGIN=https://your-frontend.example
APPLE_VERIFY_RATE_LIMIT=30
APPLE_VANITY_RATE_LIMIT=6
```

Do not put `BSCSCAN_API_KEY`, `PRIVATE_KEY`, or `APPLE_BACKEND_TOKEN` in frontend env variables.

Frontend environment:

```bash
VITE_APP_BACKEND_URL=https://your-backend.example
VITE_VANITY_SUFFIX=aaaa
```

For a Netlify frontend proxy, use:

```bash
VITE_APP_BACKEND_URL=same-origin
```

Then add `public/_redirects`:

```txt
/api/*  http://154.12.118.163:8787/api/:splat  200
/health  http://154.12.118.163:8787/health  200
```

When `VITE_APP_BACKEND_URL` is configured, the launch page asks the backend for a CREATE2 salt before sending the wallet transaction. After the transaction confirms, the frontend parses the `LaunchCreated` event and queues the new project for source-code verification through the backend.

If the backend is unavailable, the frontend falls back to a random salt so token creation still works. Auto-verification can still happen later through the backend monitor.

## Verify a project manually

```bash
PROJECT_TOKEN=0x... npm run contracts:verify:project
```

The backend runs the same verification command automatically when it sees new Factory projects.

## Vanity suffix

`POST /api/vanity-salt`

The backend searches a CREATE2 salt that makes the predicted Token address end with the requested suffix. Four hex characters such as `aaaa` average about 65,536 attempts.

The salt only stays valid for the exact launch parameters, creator wallet, Factory address, and chain id used during the search.

## Whitelist and public mint order

The current Vault keeps public mint closed while whitelist quota remains. A whitelisted minter consumes whitelist quota first; if that same transaction fills the final whitelist slot, any remaining requested quantity can use public quota. After whitelist quota is fully minted, public mint opens for everyone.
