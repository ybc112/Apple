# Apple Launch Contract Design

## Core Contracts

- `AppleLaunchFactory`
  - Collects the launch creation fee.
  - Deploys one `AppleToken` and one `AppleMintVault` for every project.
  - Stores project metadata, token address, vault address, mint price, mint count, payment token, receiver, template id, and whitelist mode.
  - Fee recipient defaults to `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347` in the deploy script.

- `AppleToken`
  - ERC20 token with fixed total supply.
  - Stores project URI, template id, receiver, payment token, reward token, reward threshold, and tax configuration.
  - Supports buy/sell tax against configured AMM pairs.
  - Burns the burn split and routes the rest of tax to the receiver.
  - Ownership is transferred to the project receiver after launch.

- `AppleMintVault`
  - Holds the full token supply allocated for public mint.
  - Handles native BNB minting and ERC20 payment-token minting.
  - Sends mint payment directly to the project receiver.
  - Tracks `mintedCount`, per-wallet minted amount, and progress.
  - Supports pause, receiver update, and whitelist controls.

## Whitelist Design

Whitelist mode is controlled per project vault.

- `whitelistEnabled`
  - If `false`, anyone can mint while supply remains.
  - If `true`, `mint()` checks the caller's whitelist allowance.

- `setWhitelistEnabled(bool enabled)`
  - Vault owner can open or close whitelist mode.

- `setWhitelistAllowance(address account, uint256 allowance)`
  - Vault owner sets one wallet's max mint quantity.

- `setWhitelistAllowances(address[] accounts, uint256[] allowances)`
  - Vault owner batch-sets whitelist allowances.

- `whitelistRemaining(address account)`
  - Returns how many mint slots the wallet still has.

The whitelist allowance is quantity-based, not token-amount-based. For example, if `tokensPerMint` is `500000 APPLE` and a wallet has allowance `2`, that wallet can mint two times.

## Fee Policy

- Factory creation fee: `0.005 BNB`.
- Default fee recipient: `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347`.
- The factory owner can update `creationFee` and `feeRecipient`.
- Mint payments are separate from the factory fee and go to the project receiver.

## Deployment Flow

1. Deploy `AppleLaunchFactory(feeRecipient, creationFee)`.
2. Set `VITE_LAUNCHPAD_FACTORY_ADDRESS` to the deployed factory address.
3. User connects wallet and calls `createLaunch`.
4. Factory deploys token and vault.
5. Factory transfers all token supply into the vault.
6. Token ownership goes to the project receiver.
7. Vault ownership belongs to the project receiver.
8. If whitelist mode is enabled, receiver sets whitelist allowances before mint starts.

## BNB Chain Deployment

- Network: BNB Smart Chain mainnet (`chainId: 56`).
- Factory: `0x924aF77296c67a613893373Eef2ae0dd2318e0C2`.
- Deployment transaction: `0x3b8a8317ee588ceae62fda63d43ca253e4e79ab57f12512d1ad0c333cef7de62`.
- Fee recipient: `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347`.
- Creation fee: `0.005 BNB`.

## Test Coverage

Current tests cover:

- Factory deploys independent token and vault after receiving creation fee.
- Users can mint real ERC20 balances from the vault.
- Factory rejects launch creation without the required fee.
- Whitelist mode blocks non-whitelisted minting, allows configured allowance, and rejects over-limit minting.
