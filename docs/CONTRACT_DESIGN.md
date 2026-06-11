# Apple Launch Contract Design

## Core Contracts

- `AppleLaunchFactory`
  - Collects the launch creation fee.
  - Deploys one `AppleToken` and one `AppleMintVault` for every project.
  - Stores project metadata, token address, vault address, mint price, mint count, payment token, receiver, template id, whitelist mode, reward config, and tax split config.
  - Indexes projects by creator and template id for deployment history and template-based lists.
  - Exposes paged project reads through `getProjects(offset, limit)`.
  - Defaults an empty reward token to BSC USDT: `0x55d398326f99059fF775485246999027B3197955`.
  - Fee recipient defaults to `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347` in the deploy script.

- `AppleToken`
  - ERC20 token with fixed total supply.
  - Stores project URI, template id, receiver, payment token, reward token, reward threshold, and tax configuration.
  - Keeps normal user transfers locked until the mint vault finalizes the launch.
  - Trading is enabled only by the project's `AppleMintVault` when the launch sells out.
  - Supports buy/sell tax against configured AMM pairs.
  - Routes tax by split:
    - Marketing goes to the project receiver.
    - LP / buyback goes to `0x000000000000000000000000000000000000dEaD`.
    - Holder reward goes to the dividend receiver, which defaults to the project receiver and can be changed by the token owner.
    - Burn reduces total supply.
    - Any unallocated tax split goes to the project receiver.
  - Ownership is transferred to the project creator after launch.
  - Token owner can update tax config, marketing receiver, dividend receiver, reward token config, tax exemptions, and AMM pairs.

- `AppleMintVault`
  - Holds the full token supply allocated for public mint.
  - Handles native BNB minting and ERC20 payment-token minting.
  - Escrows mint payment during the 24-hour launch window.
  - Automatically finalizes the launch when `mintedCount == totalMints`.
  - On finalization, enables token trading and pays escrowed mint funds to the project receiver.
  - If the launch is not sold out after 24 hours, buyers can refund by returning their minted tokens to the vault.
  - Tracks `mintedCount`, whitelist minted count, public minted count, per-wallet minted amount, and progress.
  - Separates whitelist quota from public quota through `whitelistMintLimit` and `publicMintLimit`.
  - Supports receiver update and whitelist controls.
  - Ownership belongs to the project creator, not the receiver wallet.

- `AppleAuditRegistry`
  - Separate on-chain registry for the auditor system.
  - Wallets call `applyAuditor(profileUri)` to submit an on-chain auditor application.
  - Registry owner approves auditors through `setAuditorStatus(auditor, AuditorStatus.Approved)`.
  - Approved auditors call `submitReview(projectToken, score, riskLevel, reportUri)` to publish project reviews.
  - Stores reviewer wallet, project token, score, risk level, report URI, and update time.
  - Supports reading all reviews for a project through `getProjectReviews(projectToken)`.

## Whitelist Design

Whitelist mode is controlled per project vault.

- `whitelistEnabled`
  - If `false`, all mint slots are public.
  - If `true`, whitelisted wallets can consume reserved whitelist slots, while non-whitelisted wallets can only consume remaining public slots.

- `whitelistMintLimit`
  - Number of mint slots reserved for whitelist allocation.

- `publicMintLimit`
  - Number of mint slots open to everyone.

- `setWhitelistEnabled(bool enabled)`
  - Vault owner can open or close whitelist mode.

- `setWhitelistAllowance(address account, uint256 allowance)`
  - Vault owner sets one wallet's max mint quantity.

- `setWhitelistAllowances(address[] accounts, uint256[] allowances)`
  - Vault owner batch-sets whitelist allowances.

- `whitelistRemaining(address account)`
  - Returns how many mint slots the wallet still has.

The whitelist allowance is quantity-based, not token-amount-based. For example, if `tokensPerMint` is `500000 APPLE` and a wallet has allowance `2`, that wallet can mint two times.

Only the vault owner can update whitelist allowances. The factory sets the vault owner to the wallet that created the project.

## Fee Policy

- Factory creation fee: `0.005 BNB`.
- Default fee recipient: `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347`.
- The factory owner can update `creationFee` and `feeRecipient`.
- Mint payments are separate from the factory fee.
- Mint payments stay in the project's vault until the launch sells out.
- If the launch sells out, the vault enables token trading and transfers escrowed mint payments to the project receiver.
- If the launch is not sold out after 24 hours, buyers can call `claimRefund()` after approving the vault to take back their minted launch tokens.

## Refund And Auto-Trading Policy

- `refundDeadline` is set to `block.timestamp + 24 hours` when the vault is deployed.
- `mint()` is available only before `refundDeadline` and only while the launch is not finalized.
- When the final mint slot is filled, the vault calls `AppleToken.finalizeLaunch()` and sends escrowed payment to the receiver.
- `AppleToken.finalizeLaunch()` can only be called by the assigned vault.
- Before finalization, regular transfers between non-exempt addresses revert with `TradingLocked`.
- After finalization, trading stays enabled; the auditor registry has no function that can pause or stop token trading.
- `claimRefund()` is available only after `refundDeadline`, only if the launch is not finalized, and only for wallets with a paid mint balance.
- Refund claims zero the wallet's mint/payment accounting, decrement active mint counters, transfer the minted launch tokens back to the vault, and return the user's BNB/ERC20 payment.

## Tax Split Policy

The UI fields map to contract fields as follows:

- `销毁` -> `burnFeeBps`
- `营销` -> `fundFeeBps`
- `回流` -> `lpFeeBps`, always routed to `AppleToken.LP_BLACK_HOLE()`
- `持币分红` -> `dividendFeeBps`, routed to `dividendReceiver`

The split total can be lower than 100%. The remaining unallocated part of a charged tax goes to the project receiver. The split total cannot exceed 100%, and buy/sell tax cannot exceed 25%.

## Auditor Design

The auditor page is backed by `AppleAuditRegistry`; it does not show fake audit queues.

Common launchpads usually handle review credibility in one of three ways:

- A centralized admin marks trusted auditors and audited projects.
- A trusted signer signs off-chain reports, and the frontend verifies the signature.
- A registry contract stores approved auditors and their project attestations.

This project uses the registry-contract approach:

- Anyone can apply as an auditor by writing a profile URI on-chain.
- Only the registry owner can approve auditors.
- The audit registry cannot pause trading and cannot control launch finalization.
- Only approved auditors can submit project reviews.
- Re-submitting a review for the same project updates the existing review instead of duplicating counts.
- Report content can live on IPFS, GitHub, Notion, a website, or another public URI; the contract stores the URI.

Frontend integration:

- Set `VITE_AUDIT_REGISTRY_ADDRESS` after deploying `AppleAuditRegistry`.
- If the address is missing, the page shows a configuration warning instead of fake data.
- If the connected wallet is the registry owner, the frontend shows auditor approval controls.
- If the connected wallet is an approved auditor, the frontend enables project-review submission.

The Swap page and Swap navigation were removed. There is no placeholder swap module in the UI.

## Deployment Flow

1. Deploy `AppleLaunchFactory(feeRecipient, creationFee)`.
2. Deploy `AppleAuditRegistry`.
3. Set `VITE_LAUNCHPAD_FACTORY_ADDRESS` and `VITE_AUDIT_REGISTRY_ADDRESS`.
4. User connects wallet and calls `createLaunch`.
5. Factory deploys token and vault.
6. Factory transfers all token supply into the vault.
7. Token ownership goes to the project creator.
8. Vault ownership belongs to the project creator.
9. If whitelist mode is enabled, the project creator sets whitelist allowances before mint starts.
10. Buyers mint from the vault during the 24-hour window.
11. If sold out, the vault automatically enables trading and pays the receiver.
12. If not sold out after 24 hours, buyers can approve the vault and call `claimRefund()`.

The current UI only offers BNB and USDT for mint payments. USD1 was removed from the selectable payment-token list. Contracts still support any valid ERC20 payment token if called directly.

## BNB Chain Deployment

The source code has been updated after the deployment below. Redeploy before using the LP black-hole and indexed query features on mainnet.

- Network: BNB Smart Chain mainnet (`chainId: 56`).
- Previous Factory: `0x924aF77296c67a613893373Eef2ae0dd2318e0C2`.
- Deployment transaction: `0x3b8a8317ee588ceae62fda63d43ca253e4e79ab57f12512d1ad0c333cef7de62`.
- Fee recipient: `0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347`.
- Creation fee: `0.005 BNB`.

## Test Coverage

Current tests cover:

- Factory deploys independent token and vault after receiving creation fee.
- Users can mint real ERC20 balances from the vault.
- Factory rejects launch creation without the required fee.
- Factory refunds deployment fee overpayment.
- Whitelist mode blocks non-whitelisted minting, allows configured allowance, and rejects over-limit minting.
- Public and whitelist mint quotas are tracked separately.
- Only the creator-owned vault can update whitelist allowance.
- Creator/template indexes and paged project reads are populated.
- Launch mint payments are escrowed until sold out.
- Sold-out launches automatically enable trading and pay the receiver.
- Unsold launches allow buyers to refund after 24 hours by returning minted tokens.
- Regular token transfers are locked before sellout and unlocked automatically after sellout.
- Sell tax routes LP to the black hole, burns the burn split, and routes marketing/dividend splits correctly.
- Auditor registry covers application, owner approval, approved-auditor-only review submission, review updates, and project review reads.
