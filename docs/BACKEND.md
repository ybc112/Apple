# Apple backend

This backend keeps secret operational logic out of the browser.

## What it does

- Watches the configured Factory for new projects.
- Queues BscScan verification for each new project Token and Vault.
- Exposes a vanity salt API for fixed token address suffixes such as `5555` or `aaaa`.

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
FACTORY_ADDRESS=0x2a675D757a13bbA48A088dA5af72E8c53F445Ea1
APPLE_BACKEND_PORT=8787
AUTO_VERIFY_PROJECTS=true
```

Do not put `BSCSCAN_API_KEY`, `PRIVATE_KEY`, or `APPLE_BACKEND_TOKEN` in frontend env variables.

## Verify a project manually

```bash
PROJECT_TOKEN=0x... npm run contracts:verify:project
```

The backend runs the same verification command automatically when it sees new Factory projects.

## Vanity suffix

`POST /api/vanity-salt`

The backend searches a CREATE2 salt that makes the predicted Token address end with the requested suffix. Four hex characters such as `5555` or `aaaa` average about 65,536 attempts.

The salt only stays valid for the exact launch parameters, creator wallet, Factory address, and chain id used during the search.

## Whitelist and public mint order

The current Vault consumes whitelist quota first when the minter has whitelist allowance. Any remaining requested quantity then uses public quota. If the public quota is full and the wallet has no remaining whitelist allowance, mint reverts.
