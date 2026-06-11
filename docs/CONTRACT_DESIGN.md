# Apple Launch Contract Design

## Core Contracts

- `AppleLaunchFactory`
  - Collects the launch creation fee.
  - Coordinates `AppleTokenDeployer` and `AppleMintVaultDeployer` to deploy one token and one vault for every project.
  - Stores project metadata, token address, vault address, mint price, mint count, payment token, receiver, template id, whitelist mode, reward config, and tax split config.
  - Indexes projects by creator and template id for deployment history and template-based lists.
  - Exposes paged project reads through `getProjects(offset, limit)`.
  - Defaults an empty reward token to BSC USDT: `0x55d398326f99059fF775485246999027B3197955`.
  - Fee recipient is supplied from deployment environment variables and is not displayed in the app UI.

- `AppleToken`
  - ERC20 token with fixed total supply.
  - Stores project URI, template id, receiver, platform fee receiver, payment token, reward token, reward threshold, and tax configuration.
  - Keeps normal user transfers locked until the mint vault finalizes the launch.
  - Trading is enabled only by the project's `AppleMintVault` when the launch sells out.
  - When trading opens, token ownership is automatically transferred to `0x000000000000000000000000000000000000dEaD`.
  - After trading opens, the creator can no longer change taxes, receivers, reward config, tax exemptions, or AMM pair flags.
  - Supports buy/sell tax against configured AMM pairs.
  - Routes tax by split:
    - 10% of the collected tax amount goes to the platform service fee receiver.
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
  - For BNB mint projects, reserves 50% of supply for sale mints and 50% for Pancake V2 liquidity.
  - Every successful BNB mint immediately adds that mint's BNB plus its matching token reserve into Pancake V2 liquidity.
  - LP tokens are held by the vault during the launch window so failed launches can remove LP and refund buyers.
  - Automatically finalizes the launch when `mintedCount == totalMints`.
  - On finalization, transfers remaining LP to the black-hole address, marks the pair as an AMM pair, and enables token trading.
  - If the launch is not sold out after 24 hours, buyers can refund by returning their minted tokens; the vault removes the wallet's LP share and refunds recovered BNB.
  - Tracks `mintedCount`, whitelist minted count, public minted count, per-wallet minted amount, and progress.
  - Separates whitelist quota from public quota through `whitelistMintLimit` and `publicMintLimit`.
  - Supports receiver update and whitelist controls.
  - Ownership belongs to the project creator during the launch window, not the receiver wallet.
  - When the launch sells out, vault ownership is automatically transferred to `0x000000000000000000000000000000000000dEaD`, so whitelist and receiver settings are locked after trading opens.

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
  - If `true`, public mint stays closed while whitelist quota remains.
  - Whitelisted wallets consume reserved whitelist slots first.
  - If one transaction fills the final whitelist slot, that same transaction may use public quota for any remaining requested quantity.

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
  - The sum of all configured whitelist allowances cannot exceed `whitelistMintLimit`.

- `whitelistRemaining(address account)`
  - Returns how many mint slots the wallet still has.

The whitelist allowance is quantity-based, not token-amount-based. For example, if `tokensPerMint` is `500000 APPLE` and a wallet has allowance `2`, that wallet can mint two times.

Only the vault owner can update whitelist allowances. The factory sets the vault owner to the wallet that created the project.

## Fee Policy

- Factory creation fee: `0.005 BNB`.
- Fee recipient is configured through `FEE_RECIPIENT` during deployment.
- The factory owner can update `creationFee` and `feeRecipient`.
- Mint payments are separate from the factory fee.
- For buy/sell tax, the platform receives 10% of the collected tax amount. For example, a 10% sell tax routes 1% of the trade amount to the platform and distributes the remaining 9% by the project tax split.
- BNB mint payments are added to Pancake V2 liquidity immediately per mint; LP stays in the vault until sellout.
- ERC20 mint payments stay in the project's vault until the launch sells out.
- If a BNB launch sells out, the vault locks LP in the black hole and enables token trading.
- If an ERC20-paid launch sells out, the vault enables token trading and transfers escrowed payment tokens to the project receiver.
- If the launch is not sold out after 24 hours, buyers can call `claimRefund()` after approving the vault to take back their minted launch tokens.

## Refund And Auto-Trading Policy

- `refundDeadline` is set to `block.timestamp + 24 hours` when the vault is deployed.
- `mint()` is available only before `refundDeadline` and only while the launch is not finalized.
- Buyers must call `mint(uint256)`; direct BNB transfers to the vault are rejected and cannot mint.
- For BNB launches, each mint calls Pancake V2 `addLiquidityETH` with that mint's BNB and matching reserve tokens.
- When the final mint slot is filled, the vault sends remaining LP to the black-hole address and calls `AppleToken.finalizeLaunch(pair)`.
- `AppleToken.finalizeLaunch()` can only be called by the assigned vault.
- `AppleToken.finalizeLaunch(pair)` marks the liquidity pair as an AMM pair, enables trading, and transfers token ownership to the black-hole address.
- The vault transfers its own ownership to the black-hole address in the same finalization flow.
- Before finalization, regular transfers between non-exempt addresses revert with `TradingLocked`.
- After finalization, trading stays enabled; the auditor registry has no function that can pause or stop token trading.
- After finalization, the project creator cannot change taxes, receivers, tax exemptions, pair flags, whitelist settings, or the vault receiver.
- `claimRefund()` is available only after `refundDeadline`, only if the launch is not finalized, and only for wallets with a paid mint balance.
- BNB refund claims zero the wallet's mint/payment accounting, decrement active mint counters, transfer minted launch tokens back to the vault, remove the wallet's LP share, and return recovered BNB.
- ERC20 refund claims return the user's escrowed ERC20 payment.

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

## PancakeSwap Integration

The Swap page is a real frontend integration with PancakeSwap V2 Router on BNB Chain.

- Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`.
- The UI supports `BNB -> project token` and `project token -> BNB`.
- Quotes are read from `getAmountsOut`.
- Buy swaps call `swapExactETHForTokensSupportingFeeOnTransferTokens`.
- Sell swaps call `swapExactTokensForETHSupportingFeeOnTransferTokens`.
- Sell swaps require an ERC20 `approve` transaction before calling the router if allowance is insufficient.
- The project does not deploy or control a custom swap contract; funds go directly through PancakeSwap.
- If a launched token has no BNB liquidity, the UI shows a quote/liquidity error instead of pretending a trade can execute.
- Taxed tokens can receive less than the displayed quote because Pancake quotes do not fully model transfer-tax behavior; the UI shows a warning for this.

## Deployment Flow

1. Deploy `AppleTokenDeployer` and `AppleMintVaultDeployer`.
2. Deploy `AppleLaunchFactory(feeRecipient, creationFee, pancakeRouter, tokenDeployer, vaultDeployer)`.
3. Bind both deployers to the Factory with `setFactory(factory)`.
4. Deploy `AppleAuditRegistry`.
5. Set `VITE_LAUNCHPAD_FACTORY_ADDRESS` and `VITE_AUDIT_REGISTRY_ADDRESS`.
6. User connects wallet and calls `createLaunch`.
7. Factory deploys token and vault.
8. Factory transfers all token supply into the vault.
9. Token ownership goes to the project creator.
10. Vault ownership belongs to the project creator during the launch window.
11. If whitelist mode is enabled, the project creator sets whitelist allowances before mint starts.
12. Buyers mint from the vault during the 24-hour window.
13. Each BNB mint automatically adds a matching Pancake V2 liquidity position and keeps LP in the vault.
14. If sold out, the vault locks LP in the black hole, enables trading, and sends token/vault ownership to the black-hole address.
15. If not sold out after 24 hours, buyers can approve the vault and call `claimRefund()`.

The current UI only offers BNB and USDT for mint payments. USD1 was removed from the selectable payment-token list. Contracts still support any valid ERC20 payment token if called directly.

## BNB Chain Deployment

- Network: BNB Smart Chain mainnet (`chainId: 56`).
- Factory: `0x9C0C827b3E4a386939E5F3221c2A13c65f808278`.
- Token Deployer: `0xf10445603aAEEDF5aEa579e6059C65796A23E3CA`.
- Vault Deployer: `0xec5095945F9466aF35303b1726465E1dc0AE1466`.
- Pancake V2 Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`.
- Audit Registry: `0x236e9ea1Fba44C911ccbd0A0C8e79c02974d3084`.
- Factory deployment transaction: `0x5d93da00386a414b3fcc765513111441084a1314c6d2c0d65fb404c14cef6f1e`.
- Audit Registry deployment transaction: `0x6c44e82d89b2849bb960691e3dda77c82158d48a4ce255bc62d17b46a257435a`.
- Fee recipient: configured by environment variable during deployment.
- Creation fee: `0.005 BNB`.
- Factory source is verified on BscScan: `https://bscscan.com/address/0x9C0C827b3E4a386939E5F3221c2A13c65f808278#code`.
- Token Deployer source is verified on BscScan: `https://bscscan.com/address/0xf10445603aAEEDF5aEa579e6059C65796A23E3CA#code`.
- Vault Deployer source is verified on BscScan: `https://bscscan.com/address/0xec5095945F9466aF35303b1726465E1dc0AE1466#code`.
- Audit Registry source is verified on BscScan: `https://bscscan.com/address/0x236e9ea1Fba44C911ccbd0A0C8e79c02974d3084#code`.

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
- BNB mints automatically add Pancake V2 liquidity per mint and hold LP in the vault.
- Sold-out launches automatically lock LP, mark the pair, and enable trading.
- Unsold launches allow buyers to refund after 24 hours by returning minted tokens and removing their LP share.
- Regular token transfers are locked before sellout and unlocked automatically after sellout.
- Sell tax routes LP to the black hole, burns the burn split, and routes marketing/dividend splits correctly.
- Auditor registry covers application, owner approval, approved-auditor-only review submission, review updates, and project review reads.
