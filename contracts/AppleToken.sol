// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface IAppleTaxRouter {
    function WETH() external view returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external;
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external;
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IAppleLaunchMintVault {
    function mintPrice() external view returns (uint256);
    function mintFor(address minter, uint256 quantity) external payable;
}

interface IAppleLiquidityPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

contract AppleDividendDistributor {
    using SafeERC20 for IERC20;

    uint256 public constant DIVIDENDS_PER_SHARE_ACCURACY = 10 ** 36;

    IERC20 public immutable rewardToken;
    address public immutable token;
    address[] public shareholders;
    uint256 public claimWait;

    struct Share {
        uint256 amount;
        uint256 totalExcluded;
        uint256 totalRealised;
    }

    mapping(address shareholder => Share share) public shares;
    mapping(address shareholder => uint256 index) public shareholderIndexes;
    mapping(address shareholder => uint256 timestamp) public shareholderClaims;
    mapping(address shareholder => bool excluded) public excludedFromDividends;

    uint256 public totalShares;
    uint256 public totalDividends;
    uint256 public totalDistributed;
    uint256 public pendingDividends;
    uint256 public dividendsPerShare;
    uint256 public currentIndex;

    error ClaimWaitNotElapsed();
    error InvalidClaimWait();
    error NotToken();
    error ZeroAddress();

    modifier onlyToken() {
        if (msg.sender != token) {
            revert NotToken();
        }
        _;
    }

    constructor(address rewardToken_, uint256 claimWait_) {
        if (rewardToken_ == address(0)) {
            revert ZeroAddress();
        }

        rewardToken = IERC20(rewardToken_);
        token = msg.sender;
        _setClaimWait(claimWait_);
    }

    function shareholderCount() external view returns (uint256) {
        return shareholders.length;
    }

    function setShare(address shareholder, uint256 amount) external onlyToken {
        _setShare(shareholder, amount);
    }

    function setBalance(address shareholder, uint256 amount) external onlyToken {
        _setShare(shareholder, amount);
    }

    function excludeFromDividends(address shareholder) external onlyToken {
        excludedFromDividends[shareholder] = true;
        _setShare(shareholder, 0);
    }

    function includeInDividends(address shareholder, uint256 amount) external onlyToken {
        excludedFromDividends[shareholder] = false;
        _setShare(shareholder, amount);
    }

    function setClaimWait(uint256 nextClaimWait) external onlyToken {
        _setClaimWait(nextClaimWait);
    }

    function _setShare(address shareholder, uint256 amount) private {
        if (excludedFromDividends[shareholder]) {
            amount = 0;
        }
        if (shares[shareholder].amount > 0) {
            _distributeDividend(shareholder, false);
        }

        if (amount > 0 && shares[shareholder].amount == 0) {
            _addShareholder(shareholder);
        } else if (amount == 0 && shares[shareholder].amount > 0) {
            _removeShareholder(shareholder);
        }

        uint256 previousTotalShares = totalShares;
        totalShares = totalShares - shares[shareholder].amount + amount;
        shares[shareholder].amount = amount;
        shares[shareholder].totalExcluded = _cumulativeDividends(amount);

        if (previousTotalShares == 0 && totalShares > 0) {
            _distributePendingDividends();
        }
    }

    function deposit(uint256 amount) external onlyToken {
        if (amount == 0) {
            return;
        }

        totalDividends += amount;
        pendingDividends += amount;
        _distributePendingDividends();
    }

    function process(uint256 gasLimit) external onlyToken {
        uint256 shareholderTotal = shareholders.length;
        if (shareholderTotal == 0) {
            return;
        }

        uint256 gasUsed;
        uint256 gasLeft = gasleft();
        uint256 iterations;

        while (gasUsed < gasLimit && iterations < shareholderTotal) {
            if (currentIndex >= shareholderTotal) {
                currentIndex = 0;
            }

            address shareholder = shareholders[currentIndex];
            if (canAutoClaim(shareholderClaims[shareholder])) {
                _distributeDividend(shareholder, false);
            }

            unchecked {
                iterations++;
                currentIndex++;
            }

            uint256 nextGasLeft = gasleft();
            gasUsed += gasLeft - nextGasLeft;
            gasLeft = nextGasLeft;
        }
    }

    function claimDividend() external {
        _distributeDividend(msg.sender, true);
    }

    function claimDividendFor(address shareholder) external onlyToken {
        _distributeDividend(shareholder, true);
    }

    function withdrawDividend() external {
        _distributeDividend(msg.sender, true);
    }

    function processAccount(address account, bool automatic) external onlyToken returns (bool) {
        _distributeDividend(account, !automatic);
        return true;
    }

    function dividendOf(address shareholder) external view returns (uint256) {
        return getUnpaidEarnings(shareholder);
    }

    function withdrawableDividendOf(address shareholder) external view returns (uint256) {
        return getUnpaidEarnings(shareholder);
    }

    function withdrawnDividendOf(address shareholder) external view returns (uint256) {
        return shares[shareholder].totalRealised;
    }

    function accumulativeDividendOf(address shareholder) external view returns (uint256) {
        return _cumulativeDividends(shares[shareholder].amount);
    }

    function lastClaimTimes(address shareholder) external view returns (uint256) {
        return shareholderClaims[shareholder];
    }

    function canAutoClaim(uint256 lastClaimTime) public view returns (bool) {
        if (lastClaimTime > block.timestamp) {
            return false;
        }

        return block.timestamp - lastClaimTime >= claimWait;
    }

    function getUnpaidEarnings(address shareholder) public view returns (uint256) {
        uint256 shareholderTotalDividends = _cumulativeDividends(shares[shareholder].amount);
        uint256 shareholderTotalExcluded = shares[shareholder].totalExcluded;

        if (shareholderTotalDividends <= shareholderTotalExcluded) {
            return 0;
        }

        return shareholderTotalDividends - shareholderTotalExcluded;
    }

    function _distributeDividend(address shareholder, bool enforceWait) private {
        if (shares[shareholder].amount == 0) {
            return;
        }
        if (enforceWait && !canAutoClaim(shareholderClaims[shareholder])) {
            revert ClaimWaitNotElapsed();
        }

        uint256 amount = getUnpaidEarnings(shareholder);
        if (amount == 0) {
            return;
        }

        totalDistributed += amount;
        shareholderClaims[shareholder] = block.timestamp;
        shares[shareholder].totalRealised += amount;
        shares[shareholder].totalExcluded = _cumulativeDividends(shares[shareholder].amount);
        rewardToken.safeTransfer(shareholder, amount);
    }

    function _cumulativeDividends(uint256 share) private view returns (uint256) {
        return (share * dividendsPerShare) / DIVIDENDS_PER_SHARE_ACCURACY;
    }

    function _distributePendingDividends() private {
        if (pendingDividends == 0 || totalShares == 0) {
            return;
        }

        uint256 amount = pendingDividends;
        pendingDividends = 0;
        dividendsPerShare += (amount * DIVIDENDS_PER_SHARE_ACCURACY) / totalShares;
    }

    function _addShareholder(address shareholder) private {
        shareholderIndexes[shareholder] = shareholders.length;
        shareholders.push(shareholder);
    }

    function _removeShareholder(address shareholder) private {
        uint256 lastIndex = shareholders.length - 1;
        address lastShareholder = shareholders[lastIndex];
        uint256 removeIndex = shareholderIndexes[shareholder];

        shareholders[removeIndex] = lastShareholder;
        shareholderIndexes[lastShareholder] = removeIndex;
        shareholders.pop();
    }

    function _setClaimWait(uint256 nextClaimWait) private {
        if (nextClaimWait > 24 hours) {
            revert InvalidClaimWait();
        }

        claimWait = nextClaimWait;
    }
}

contract AppleToken is ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_TAX_BPS = 2_500;
    uint16 public constant PLATFORM_TAX_SHARE_BPS = 1_000;
    address public constant LP_BLACK_HOLE = 0x000000000000000000000000000000000000dEaD;

    string public projectUri;
    bytes32 public templateId;
    address public factory;
    address public launchVault;
    address public receiver;
    address public platformFeeReceiver;
    address public dividendReceiver;
    address public paymentToken;
    address public rewardToken;
    uint256 public rewardThreshold;
    bool public tradingEnabled;

    IAppleTaxRouter public liquidityRouter;
    AppleDividendDistributor public dividendDistributor;
    address public liquidityPair;
    bool public swapEnabled = true;
    bool private _swapping;
    uint256 public swapThreshold;
    uint256 public distributorGas = 300_000;

    uint256 public tokensForPlatform;
    uint256 public tokensForMarketing;
    uint256 public tokensForLiquidity;
    uint256 public tokensForDividends;
    uint256 public totalPlatformRouted;
    uint256 public totalMarketingRouted;
    uint256 public totalLiquidityAdded;
    uint256 public totalDividendsDeposited;
    uint256 public totalTaxBurned;
    uint256 public startTradeBlock;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public transferTaxBps;
    uint16 public addLiquidityTaxBps;
    uint16 public removeLiquidityTaxBps;
    uint16 public launchProtectionTaxBps;
    uint16 public launchProtectionBlocks;
    uint16 public fundFeeBps;
    uint16 public lpFeeBps;
    uint16 public dividendFeeBps;
    uint16 public burnFeeBps;

    mapping(address account => bool enabled) public isTaxExempt;
    mapping(address account => bool enabled) public isDividendExempt;
    mapping(address pair => bool enabled) public automatedMarketMakerPairs;

    error InvalidTax();
    error NotLaunchVault();
    error InvalidMintPayment();
    error PairAlreadySet();
    error RewardTokenLocked();
    error RouterAlreadySet();
    error TradingLocked();
    error VaultAlreadySet();
    error ZeroAddress();

    struct TaxConfig {
        uint16 buyTaxBps;
        uint16 sellTaxBps;
        uint16 transferTaxBps;
        uint16 addLiquidityTaxBps;
        uint16 removeLiquidityTaxBps;
        uint16 launchProtectionTaxBps;
        uint16 launchProtectionBlocks;
        uint32 claimWait;
        uint16 fundFeeBps;
        uint16 lpFeeBps;
        uint16 dividendFeeBps;
        uint16 burnFeeBps;
    }

    struct LaunchConfig {
        string name;
        string symbol;
        string projectUri;
        bytes32 templateId;
        address receiver;
        address platformFeeReceiver;
        address paymentToken;
        address rewardToken;
        uint256 rewardThreshold;
        uint256 totalSupply;
    }

    event LaunchVaultSet(address indexed vault);
    event LiquidityRouterSet(address indexed router);
    event ReceiverUpdated(address indexed receiver);
    event DividendReceiverUpdated(address indexed dividendReceiver);
    event RewardConfigUpdated(address indexed rewardToken, uint256 rewardThreshold);
    event TradingEnabled();
    event AdvancedTaxUpdated(
        uint16 transferTaxBps,
        uint16 addLiquidityTaxBps,
        uint16 removeLiquidityTaxBps,
        uint16 launchProtectionTaxBps,
        uint16 launchProtectionBlocks
    );
    event SwapSettingsUpdated(bool enabled, uint256 threshold);
    event DistributorGasUpdated(uint256 gasLimit);
    event TaxConfigUpdated(
        uint16 buyTaxBps,
        uint16 sellTaxBps,
        uint16 transferTaxBps,
        uint16 addLiquidityTaxBps,
        uint16 removeLiquidityTaxBps,
        uint16 launchProtectionTaxBps,
        uint16 launchProtectionBlocks,
        uint16 fundFeeBps,
        uint16 lpFeeBps,
        uint16 dividendFeeBps,
        uint16 burnFeeBps
    );
    event TaxExemptUpdated(address indexed account, bool enabled);
    event DividendExemptUpdated(address indexed account, bool enabled);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool enabled);
    event TaxCollected(
        address indexed from,
        address indexed to,
        uint256 platformAmount,
        uint256 marketingAmount,
        uint256 liquidityAmount,
        uint256 dividendAmount,
        uint256 burnAmount,
        uint256 netAmount
    );
    event SwapBack(
        uint256 platformTokens,
        uint256 marketingTokens,
        uint256 liquidityTokens,
        uint256 dividendTokens,
        uint256 nativeReceived,
        uint256 rewardReceived
    );
    event AutoLiquidityAdded(uint256 tokenAmount, uint256 nativeAmount, uint256 liquidity);

    modifier swapping() {
        _swapping = true;
        _;
        _swapping = false;
    }

    constructor(
        LaunchConfig memory launchConfig,
        TaxConfig memory taxConfig,
        address initialHolder
    )
        ERC20(launchConfig.name, launchConfig.symbol)
        Ownable(initialHolder)
    {
        if (
            launchConfig.receiver == address(0) || launchConfig.platformFeeReceiver == address(0)
                || launchConfig.rewardToken == address(0) || initialHolder == address(0)
        ) {
            revert ZeroAddress();
        }

        factory = initialHolder;
        projectUri = launchConfig.projectUri;
        templateId = launchConfig.templateId;
        receiver = launchConfig.receiver;
        platformFeeReceiver = launchConfig.platformFeeReceiver;
        dividendReceiver = launchConfig.receiver;
        paymentToken = launchConfig.paymentToken;
        rewardToken = launchConfig.rewardToken;
        rewardThreshold = launchConfig.rewardThreshold;
        dividendDistributor = new AppleDividendDistributor(launchConfig.rewardToken, taxConfig.claimWait);
        swapThreshold = launchConfig.totalSupply / 100_000;
        if (swapThreshold == 0) {
            swapThreshold = 1;
        }

        _setTaxes(taxConfig);
        isTaxExempt[initialHolder] = true;
        isTaxExempt[address(this)] = true;
        isTaxExempt[address(dividendDistributor)] = true;
        isTaxExempt[LP_BLACK_HOLE] = true;

        isDividendExempt[initialHolder] = true;
        isDividendExempt[address(this)] = true;
        isDividendExempt[address(dividendDistributor)] = true;
        isDividendExempt[LP_BLACK_HOLE] = true;
        isDividendExempt[address(0)] = true;

        _mint(initialHolder, launchConfig.totalSupply);
    }

    receive() external payable {
        _mintFromNativeTransfer();
    }

    fallback() external payable {
        _mintFromNativeTransfer();
    }

    function _mintFromNativeTransfer() private {
        if (_swapping || msg.sender == address(liquidityRouter)) {
            return;
        }
        if (launchVault == address(0) || paymentToken != address(0)) {
            revert ZeroAddress();
        }

        IAppleLaunchMintVault mintVault = IAppleLaunchMintVault(launchVault);
        uint256 price = mintVault.mintPrice();
        if (price == 0 || msg.value == 0 || msg.value % price != 0) {
            revert InvalidMintPayment();
        }

        mintVault.mintFor{ value: msg.value }(msg.sender, msg.value / price);
    }

    function setLaunchVault(address vault) external onlyOwner {
        if (vault == address(0)) {
            revert ZeroAddress();
        }
        if (launchVault != address(0)) {
            revert VaultAlreadySet();
        }

        launchVault = vault;
        isTaxExempt[vault] = true;
        isDividendExempt[vault] = true;
        emit LaunchVaultSet(vault);
    }

    function setLiquidityRouter(address router) external onlyOwner {
        if (router == address(0)) {
            revert ZeroAddress();
        }
        if (address(liquidityRouter) != address(0)) {
            revert RouterAlreadySet();
        }

        liquidityRouter = IAppleTaxRouter(router);
        emit LiquidityRouterSet(router);
    }

    function setLaunchPair(address pair) external onlyOwner {
        if (pair == address(0)) {
            revert ZeroAddress();
        }
        if (liquidityPair != address(0)) {
            revert PairAlreadySet();
        }

        liquidityPair = pair;
        automatedMarketMakerPairs[pair] = true;
        isDividendExempt[pair] = true;
        dividendDistributor.excludeFromDividends(pair);

        emit AutomatedMarketMakerPairUpdated(pair, true);
    }

    function finalizeLaunch(address pair) external {
        if (msg.sender != launchVault) {
            revert NotLaunchVault();
        }
        if (tradingEnabled) {
            return;
        }

        if (pair != address(0)) {
            liquidityPair = pair;
            automatedMarketMakerPairs[pair] = true;
            isDividendExempt[pair] = true;
            dividendDistributor.excludeFromDividends(pair);
            emit AutomatedMarketMakerPairUpdated(pair, true);
        }
        startTradeBlock = block.number;
        tradingEnabled = true;
        emit TradingEnabled();
        _transferOwnership(LP_BLACK_HOLE);
    }

    function claimDividend() external {
        dividendDistributor.claimDividendFor(msg.sender);
    }

    function mintToken() external payable {
        mint(1);
    }

    function mintToken(uint256 quantity) external payable {
        mint(quantity);
    }

    function mint() external payable {
        mint(1);
    }

    function mint(uint256 quantity) public payable {
        if (launchVault == address(0)) {
            revert ZeroAddress();
        }

        IAppleLaunchMintVault(launchVault).mintFor{ value: msg.value }(msg.sender, quantity);
    }

    function unpaidDividend(address account) external view returns (uint256) {
        return dividendDistributor.getUnpaidEarnings(account);
    }

    function minimumTokenBalanceForDividends() external view returns (uint256) {
        return rewardThreshold;
    }

    function claimWait() external view returns (uint256) {
        return dividendDistributor.claimWait();
    }

    function isAddV2() external view returns (bool) {
        return _isAddLiquidity(liquidityPair);
    }

    function isRemoveV2() external view returns (bool) {
        return _isRemoveLiquidity(liquidityPair);
    }

    function setTaxes(TaxConfig calldata taxConfig) external onlyOwner {
        _setTaxes(taxConfig);
    }

    function setReceiver(address nextReceiver) external onlyOwner {
        if (nextReceiver == address(0)) {
            revert ZeroAddress();
        }

        receiver = nextReceiver;
        emit ReceiverUpdated(nextReceiver);
    }

    function setDividendReceiver(address nextDividendReceiver) external onlyOwner {
        if (nextDividendReceiver == address(0)) {
            revert ZeroAddress();
        }

        dividendReceiver = nextDividendReceiver;
        emit DividendReceiverUpdated(nextDividendReceiver);
    }

    function setRewardConfig(address nextRewardToken, uint256 nextRewardThreshold) external onlyOwner {
        if (nextRewardToken == address(0)) {
            revert ZeroAddress();
        }
        if (nextRewardToken != rewardToken) {
            revert RewardTokenLocked();
        }

        rewardThreshold = nextRewardThreshold;
        emit RewardConfigUpdated(nextRewardToken, nextRewardThreshold);
    }

    function setAdvancedTax(
        uint16 nextTransferTaxBps,
        uint16 nextAddLiquidityTaxBps,
        uint16 nextRemoveLiquidityTaxBps,
        uint16 nextLaunchProtectionTaxBps,
        uint16 nextLaunchProtectionBlocks,
        uint32 nextClaimWait
    )
        external
        onlyOwner
    {
        _setAdvancedTax(
            nextTransferTaxBps,
            nextAddLiquidityTaxBps,
            nextRemoveLiquidityTaxBps,
            nextLaunchProtectionTaxBps,
            nextLaunchProtectionBlocks,
            nextClaimWait
        );
    }

    function setSwapSettings(bool enabled, uint256 threshold) external onlyOwner {
        swapEnabled = enabled;
        swapThreshold = threshold;
        emit SwapSettingsUpdated(enabled, threshold);
    }

    function setDistributorGas(uint256 gasLimit) external onlyOwner {
        distributorGas = gasLimit;
        emit DistributorGasUpdated(gasLimit);
    }

    function setTaxExempt(address account, bool enabled) external onlyOwner {
        isTaxExempt[account] = enabled;
        emit TaxExemptUpdated(account, enabled);
    }

    function setDividendExempt(address account, bool enabled) external onlyOwner {
        isDividendExempt[account] = enabled;
        if (enabled) {
            dividendDistributor.excludeFromDividends(account);
        } else {
            dividendDistributor.includeInDividends(account, _eligibleDividendBalance(account));
        }
        emit DividendExemptUpdated(account, enabled);
    }

    function setAutomatedMarketMakerPair(address pair, bool enabled) external onlyOwner {
        if (pair == address(0)) {
            revert ZeroAddress();
        }

        automatedMarketMakerPairs[pair] = enabled;
        isDividendExempt[pair] = enabled;
        if (enabled) {
            dividendDistributor.excludeFromDividends(pair);
        } else {
            dividendDistributor.includeInDividends(pair, _eligibleDividendBalance(pair));
        }
        emit AutomatedMarketMakerPairUpdated(pair, enabled);
    }

    function processTaxTokens() external {
        _swapBackIfNeeded();
    }

    function _setTaxes(TaxConfig memory taxConfig) private {
        if (taxConfig.buyTaxBps > MAX_TAX_BPS || taxConfig.sellTaxBps > MAX_TAX_BPS) {
            revert InvalidTax();
        }

        uint256 splitTotal = uint256(taxConfig.fundFeeBps) + taxConfig.lpFeeBps
            + taxConfig.dividendFeeBps + taxConfig.burnFeeBps;

        if (splitTotal > BPS_DENOMINATOR) {
            revert InvalidTax();
        }

        buyTaxBps = taxConfig.buyTaxBps;
        sellTaxBps = taxConfig.sellTaxBps;
        _setAdvancedTax(
            taxConfig.transferTaxBps,
            taxConfig.addLiquidityTaxBps,
            taxConfig.removeLiquidityTaxBps,
            taxConfig.launchProtectionTaxBps,
            taxConfig.launchProtectionBlocks,
            taxConfig.claimWait
        );
        fundFeeBps = taxConfig.fundFeeBps;
        lpFeeBps = taxConfig.lpFeeBps;
        dividendFeeBps = taxConfig.dividendFeeBps;
        burnFeeBps = taxConfig.burnFeeBps;

        emit TaxConfigUpdated(
            taxConfig.buyTaxBps,
            taxConfig.sellTaxBps,
            taxConfig.transferTaxBps,
            taxConfig.addLiquidityTaxBps,
            taxConfig.removeLiquidityTaxBps,
            taxConfig.launchProtectionTaxBps,
            taxConfig.launchProtectionBlocks,
            taxConfig.fundFeeBps,
            taxConfig.lpFeeBps,
            taxConfig.dividendFeeBps,
            taxConfig.burnFeeBps
        );
    }

    function _setAdvancedTax(
        uint16 nextTransferTaxBps,
        uint16 nextAddLiquidityTaxBps,
        uint16 nextRemoveLiquidityTaxBps,
        uint16 nextLaunchProtectionTaxBps,
        uint16 nextLaunchProtectionBlocks,
        uint32 nextClaimWait
    )
        private
    {
        if (
            nextTransferTaxBps > MAX_TAX_BPS || nextAddLiquidityTaxBps > MAX_TAX_BPS
                || nextRemoveLiquidityTaxBps > MAX_TAX_BPS
                || nextLaunchProtectionTaxBps > MAX_TAX_BPS
        ) {
            revert InvalidTax();
        }

        transferTaxBps = nextTransferTaxBps;
        addLiquidityTaxBps = nextAddLiquidityTaxBps;
        removeLiquidityTaxBps = nextRemoveLiquidityTaxBps;
        launchProtectionTaxBps = nextLaunchProtectionTaxBps;
        launchProtectionBlocks = nextLaunchProtectionBlocks;
        dividendDistributor.setClaimWait(nextClaimWait);

        emit AdvancedTaxUpdated(
            nextTransferTaxBps,
            nextAddLiquidityTaxBps,
            nextRemoveLiquidityTaxBps,
            nextLaunchProtectionTaxBps,
            nextLaunchProtectionBlocks
        );
    }

    function _update(address from, address to, uint256 value) internal override {
        if (_swapping) {
            super._update(from, to, value);
            return;
        }

        bool zeroValueOrMintBurn = from == address(0) || to == address(0) || value == 0;
        bool taxExemptTransfer = isTaxExempt[from] || isTaxExempt[to];
        if (zeroValueOrMintBurn || taxExemptTransfer) {
            super._update(from, to, value);
            _syncDividendShare(from);
            _syncDividendShare(to);
            _processDividends();
            return;
        }

        if (!tradingEnabled) {
            revert TradingLocked();
        }

        bool fromPair = automatedMarketMakerPairs[from];
        bool toPair = automatedMarketMakerPairs[to];
        bool addingLiquidity = toPair && _isAddLiquidity(to);
        bool removingLiquidity = fromPair && _isRemoveLiquidity(from);
        uint16 taxBps = _selectTaxBps(fromPair, toPair, addingLiquidity, removingLiquidity);

        if (taxBps == 0) {
            super._update(from, to, value);
            _syncDividendShare(from);
            _syncDividendShare(to);
            _processDividends();
            return;
        }

        uint256 fee = (value * taxBps) / BPS_DENOMINATOR;
        if (fee == 0) {
            super._update(from, to, value);
            _syncDividendShare(from);
            _syncDividendShare(to);
            _processDividends();
            return;
        }

        uint256 platformAmount = (fee * PLATFORM_TAX_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 projectFee = fee - platformAmount;
        uint256 marketingAmount = (projectFee * fundFeeBps) / BPS_DENOMINATOR;
        uint256 liquidityAmount = (projectFee * lpFeeBps) / BPS_DENOMINATOR;
        uint256 dividendAmount = (projectFee * dividendFeeBps) / BPS_DENOMINATOR;
        uint256 burnAmount = (projectFee * burnFeeBps) / BPS_DENOMINATOR;
        uint256 routedAmount = marketingAmount + liquidityAmount + dividendAmount + burnAmount;
        marketingAmount += projectFee - routedAmount;

        if (burnAmount > 0) {
            totalTaxBurned += burnAmount;
            super._update(from, LP_BLACK_HOLE, burnAmount);
        }

        uint256 collectedAmount = platformAmount + marketingAmount + liquidityAmount + dividendAmount;
        if (collectedAmount > 0) {
            tokensForPlatform += platformAmount;
            tokensForMarketing += marketingAmount;
            tokensForLiquidity += liquidityAmount;
            tokensForDividends += dividendAmount;
            super._update(from, address(this), collectedAmount);
        }

        if (to == liquidityPair) {
            try this.processTaxTokens() {}
            catch {}
        }

        uint256 netAmount = value - fee;
        super._update(from, to, netAmount);
        _syncDividendShare(from);
        _syncDividendShare(to);
        _processDividends();

        emit TaxCollected(
            from,
            to,
            platformAmount,
            marketingAmount,
            liquidityAmount,
            dividendAmount,
            burnAmount,
            netAmount
        );
    }

    function _swapBackIfNeeded() private {
        if (
            !swapEnabled || address(liquidityRouter) == address(0) || liquidityPair == address(0)
        ) {
            return;
        }

        uint256 totalTokensToProcess =
            tokensForPlatform + tokensForMarketing + tokensForLiquidity + tokensForDividends;
        if (totalTokensToProcess < swapThreshold) {
            return;
        }

        uint256 contractBalance = balanceOf(address(this));
        if (contractBalance == 0) {
            return;
        }

        if (contractBalance < totalTokensToProcess) {
            totalTokensToProcess = contractBalance;
        }

        uint256 bucketTotal =
            tokensForPlatform + tokensForMarketing + tokensForLiquidity + tokensForDividends;
        uint256 platformTokens = (tokensForPlatform * totalTokensToProcess) / bucketTotal;
        uint256 marketingTokens = (tokensForMarketing * totalTokensToProcess) / bucketTotal;
        uint256 liquidityTokens = (tokensForLiquidity * totalTokensToProcess) / bucketTotal;
        uint256 dividendTokens = totalTokensToProcess - platformTokens - marketingTokens
            - liquidityTokens;

        tokensForPlatform -= platformTokens;
        tokensForMarketing -= marketingTokens;
        tokensForLiquidity -= liquidityTokens;
        tokensForDividends -= dividendTokens;

        _swapBack(platformTokens, marketingTokens, liquidityTokens, dividendTokens);
    }

    function _selectTaxBps(
        bool fromPair,
        bool toPair,
        bool addingLiquidity,
        bool removingLiquidity
    )
        private
        view
        returns (uint16 taxBps)
    {
        if (addingLiquidity) {
            return addLiquidityTaxBps;
        }
        if (removingLiquidity) {
            return removeLiquidityTaxBps;
        }
        if (fromPair) {
            taxBps = buyTaxBps;
        } else if (toPair) {
            taxBps = sellTaxBps;
        } else {
            taxBps = transferTaxBps;
        }

        if ((fromPair || toPair) && _inLaunchProtection() && launchProtectionTaxBps > taxBps) {
            taxBps = launchProtectionTaxBps;
        }
    }

    function _inLaunchProtection() private view returns (bool) {
        return startTradeBlock > 0 && launchProtectionBlocks > 0
            && block.number <= startTradeBlock + launchProtectionBlocks;
    }

    function _isAddLiquidity(address pair) private view returns (bool) {
        if (pair == address(0) || address(liquidityRouter) == address(0)) {
            return false;
        }

        (uint256 reserve, uint256 balance) = _pairedAssetReserveAndBalance(pair);
        return balance > reserve;
    }

    function _isRemoveLiquidity(address pair) private view returns (bool) {
        if (pair == address(0) || address(liquidityRouter) == address(0)) {
            return false;
        }

        (uint256 reserve, uint256 balance) = _pairedAssetReserveAndBalance(pair);
        return balance < reserve;
    }

    function _pairedAssetReserveAndBalance(address pair)
        private
        view
        returns (uint256 reserve, uint256 balance)
    {
        if (pair.code.length == 0) {
            return (0, 0);
        }

        address wrappedNative = liquidityRouter.WETH();
        IAppleLiquidityPair liquidity = IAppleLiquidityPair(pair);
        address token0;
        address token1;
        uint112 reserve0;
        uint112 reserve1;

        try liquidity.token0() returns (address nextToken0) {
            token0 = nextToken0;
        } catch {
            return (0, 0);
        }
        try liquidity.token1() returns (address nextToken1) {
            token1 = nextToken1;
        } catch {
            return (0, 0);
        }
        try liquidity.getReserves() returns (uint112 nextReserve0, uint112 nextReserve1, uint32) {
            reserve0 = nextReserve0;
            reserve1 = nextReserve1;
        } catch {
            return (0, 0);
        }

        if (token0 == wrappedNative) {
            reserve = reserve0;
        } else if (token1 == wrappedNative) {
            reserve = reserve1;
        } else {
            return (0, 0);
        }

        balance = IERC20(wrappedNative).balanceOf(pair);
        if (balance == 0 && pair.balance > 0) {
            balance = pair.balance;
        }
    }

    function _swapBack(
        uint256 platformTokens,
        uint256 marketingTokens,
        uint256 liquidityTokens,
        uint256 dividendTokens
    )
        private
        swapping
    {
        uint256 liquidityHalf = liquidityTokens / 2;
        uint256 liquiditySwapTokens = liquidityTokens - liquidityHalf;
        uint256 nativeSwapTokens = platformTokens + marketingTokens + liquiditySwapTokens;
        uint256 nativeReceived;
        uint256 rewardReceived;

        if (nativeSwapTokens > 0) {
            uint256 nativeBefore = address(this).balance;
            _swapTokensForNative(nativeSwapTokens);
            nativeReceived = address(this).balance - nativeBefore;

            uint256 nativeForPlatform = (nativeReceived * platformTokens) / nativeSwapTokens;
            uint256 nativeForMarketing = (nativeReceived * marketingTokens) / nativeSwapTokens;
            uint256 nativeForLiquidity = nativeReceived - nativeForPlatform - nativeForMarketing;

            if (nativeForPlatform > 0) {
                totalPlatformRouted += nativeForPlatform;
                _sendNative(platformFeeReceiver, nativeForPlatform);
            }
            if (nativeForMarketing > 0) {
                totalMarketingRouted += nativeForMarketing;
                _sendNative(receiver, nativeForMarketing);
            }
            if (liquidityHalf > 0 && nativeForLiquidity > 0) {
                _addLiquidity(liquidityHalf, nativeForLiquidity);
            }
        }

        if (dividendTokens > 0) {
            rewardReceived = _swapTokensForReward(dividendTokens);
            if (rewardReceived > 0) {
                IERC20(rewardToken).safeTransfer(address(dividendDistributor), rewardReceived);
                dividendDistributor.deposit(rewardReceived);
                totalDividendsDeposited += rewardReceived;
            }
        }

        emit SwapBack(
            platformTokens,
            marketingTokens,
            liquidityTokens,
            dividendTokens,
            nativeReceived,
            rewardReceived
        );
    }

    function _swapTokensForNative(uint256 tokenAmount) private {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = liquidityRouter.WETH();

        IERC20(address(this)).forceApprove(address(liquidityRouter), tokenAmount);
        liquidityRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
        IERC20(address(this)).forceApprove(address(liquidityRouter), 0);
    }

    function _swapTokensForReward(uint256 tokenAmount) private returns (uint256 rewardReceived) {
        address[] memory path = new address[](3);
        path[0] = address(this);
        path[1] = liquidityRouter.WETH();
        path[2] = rewardToken;

        uint256 rewardBefore = IERC20(rewardToken).balanceOf(address(this));
        IERC20(address(this)).forceApprove(address(liquidityRouter), tokenAmount);
        liquidityRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
        IERC20(address(this)).forceApprove(address(liquidityRouter), 0);
        rewardReceived = IERC20(rewardToken).balanceOf(address(this)) - rewardBefore;
    }

    function _addLiquidity(uint256 tokenAmount, uint256 nativeAmount) private {
        IERC20(address(this)).forceApprove(address(liquidityRouter), tokenAmount);
        (,, uint256 liquidity) = liquidityRouter.addLiquidityETH{ value: nativeAmount }(
            address(this),
            tokenAmount,
            0,
            0,
            LP_BLACK_HOLE,
            block.timestamp
        );
        IERC20(address(this)).forceApprove(address(liquidityRouter), 0);
        totalLiquidityAdded += liquidity;
        emit AutoLiquidityAdded(tokenAmount, nativeAmount, liquidity);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool sent,) = payable(to).call{ value: amount }("");
        if (!sent) {
            return;
        }
    }

    function _eligibleDividendBalance(address account) private view returns (uint256) {
        uint256 balance = balanceOf(account);
        return balance >= rewardThreshold ? balance : 0;
    }

    function _syncDividendShare(address account) private {
        if (account == address(0) || isDividendExempt[account]) {
            return;
        }

        dividendDistributor.setShare(account, _eligibleDividendBalance(account));
    }

    function _processDividends() private {
        if (distributorGas == 0) {
            return;
        }

        dividendDistributor.process(distributorGas);
    }
}
