// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract AppleToken is ERC20, Ownable {
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

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public fundFeeBps;
    uint16 public lpFeeBps;
    uint16 public dividendFeeBps;
    uint16 public burnFeeBps;

    mapping(address account => bool enabled) public isTaxExempt;
    mapping(address pair => bool enabled) public automatedMarketMakerPairs;

    error InvalidTax();
    error NotLaunchVault();
    error TradingLocked();
    error VaultAlreadySet();
    error ZeroAddress();

    struct TaxConfig {
        uint16 buyTaxBps;
        uint16 sellTaxBps;
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
    event ReceiverUpdated(address indexed receiver);
    event DividendReceiverUpdated(address indexed dividendReceiver);
    event RewardConfigUpdated(address indexed rewardToken, uint256 rewardThreshold);
    event TradingEnabled();
    event TaxConfigUpdated(
        uint16 buyTaxBps,
        uint16 sellTaxBps,
        uint16 fundFeeBps,
        uint16 lpFeeBps,
        uint16 dividendFeeBps,
        uint16 burnFeeBps
    );
    event TaxExemptUpdated(address indexed account, bool enabled);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool enabled);
    event TaxRouted(
        address indexed from,
        address indexed to,
        uint256 platformAmount,
        uint256 marketingAmount,
        uint256 lpBlackHoleAmount,
        uint256 dividendAmount,
        uint256 burnAmount,
        uint256 netAmount
    );

    constructor(
        LaunchConfig memory launchConfig,
        TaxConfig memory taxConfig,
        address initialHolder
    )
        ERC20(launchConfig.name, launchConfig.symbol)
        Ownable(msg.sender)
    {
        if (
            launchConfig.receiver == address(0) || launchConfig.platformFeeReceiver == address(0)
                || initialHolder == address(0)
        ) {
            revert ZeroAddress();
        }

        factory = msg.sender;
        projectUri = launchConfig.projectUri;
        templateId = launchConfig.templateId;
        receiver = launchConfig.receiver;
        platformFeeReceiver = launchConfig.platformFeeReceiver;
        dividendReceiver = launchConfig.receiver;
        paymentToken = launchConfig.paymentToken;
        rewardToken = launchConfig.rewardToken;
        rewardThreshold = launchConfig.rewardThreshold;

        _setTaxes(taxConfig);
        isTaxExempt[msg.sender] = true;
        isTaxExempt[initialHolder] = true;
        isTaxExempt[launchConfig.receiver] = true;
        isTaxExempt[LP_BLACK_HOLE] = true;

        _mint(initialHolder, launchConfig.totalSupply);
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
        emit LaunchVaultSet(vault);
    }

    function finalizeLaunch() external {
        if (msg.sender != launchVault) {
            revert NotLaunchVault();
        }
        if (tradingEnabled) {
            return;
        }

        tradingEnabled = true;
        emit TradingEnabled();
        _transferOwnership(LP_BLACK_HOLE);
    }

    function setTaxes(TaxConfig calldata taxConfig) external onlyOwner {
        _setTaxes(taxConfig);
    }

    function setReceiver(address nextReceiver) external onlyOwner {
        if (nextReceiver == address(0)) {
            revert ZeroAddress();
        }

        receiver = nextReceiver;
        isTaxExempt[nextReceiver] = true;
        emit ReceiverUpdated(nextReceiver);
    }

    function setDividendReceiver(address nextDividendReceiver) external onlyOwner {
        if (nextDividendReceiver == address(0)) {
            revert ZeroAddress();
        }

        dividendReceiver = nextDividendReceiver;
        isTaxExempt[nextDividendReceiver] = true;
        emit DividendReceiverUpdated(nextDividendReceiver);
    }

    function setRewardConfig(address nextRewardToken, uint256 nextRewardThreshold) external onlyOwner {
        rewardToken = nextRewardToken;
        rewardThreshold = nextRewardThreshold;
        emit RewardConfigUpdated(nextRewardToken, nextRewardThreshold);
    }

    function setTaxExempt(address account, bool enabled) external onlyOwner {
        isTaxExempt[account] = enabled;
        emit TaxExemptUpdated(account, enabled);
    }

    function setAutomatedMarketMakerPair(address pair, bool enabled) external onlyOwner {
        if (pair == address(0)) {
            revert ZeroAddress();
        }

        automatedMarketMakerPairs[pair] = enabled;
        emit AutomatedMarketMakerPairUpdated(pair, enabled);
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
        fundFeeBps = taxConfig.fundFeeBps;
        lpFeeBps = taxConfig.lpFeeBps;
        dividendFeeBps = taxConfig.dividendFeeBps;
        burnFeeBps = taxConfig.burnFeeBps;

        emit TaxConfigUpdated(
            taxConfig.buyTaxBps,
            taxConfig.sellTaxBps,
            taxConfig.fundFeeBps,
            taxConfig.lpFeeBps,
            taxConfig.dividendFeeBps,
            taxConfig.burnFeeBps
        );
    }

    function _update(address from, address to, uint256 value) internal override {
        if (
            from == address(0) || to == address(0) || value == 0 || isTaxExempt[from]
                || isTaxExempt[to]
        ) {
            super._update(from, to, value);
            return;
        }

        if (!tradingEnabled) {
            revert TradingLocked();
        }

        uint16 taxBps = automatedMarketMakerPairs[from]
            ? buyTaxBps
            : automatedMarketMakerPairs[to] ? sellTaxBps : 0;

        if (taxBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * taxBps) / BPS_DENOMINATOR;
        if (fee == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 platformAmount = (fee * PLATFORM_TAX_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 projectFee = fee - platformAmount;
        uint256 marketingAmount = (projectFee * fundFeeBps) / BPS_DENOMINATOR;
        uint256 lpBlackHoleAmount = (projectFee * lpFeeBps) / BPS_DENOMINATOR;
        uint256 dividendAmount = (projectFee * dividendFeeBps) / BPS_DENOMINATOR;
        uint256 burnAmount = (projectFee * burnFeeBps) / BPS_DENOMINATOR;
        uint256 routedAmount = marketingAmount + lpBlackHoleAmount + dividendAmount + burnAmount;
        marketingAmount += projectFee - routedAmount;

        if (platformAmount > 0) {
            super._update(from, platformFeeReceiver, platformAmount);
        }
        if (marketingAmount > 0) {
            super._update(from, receiver, marketingAmount);
        }
        if (lpBlackHoleAmount > 0) {
            super._update(from, LP_BLACK_HOLE, lpBlackHoleAmount);
        }
        if (dividendAmount > 0) {
            super._update(from, dividendReceiver, dividendAmount);
        }
        if (burnAmount > 0) {
            super._update(from, address(0), burnAmount);
        }

        uint256 netAmount = value - fee;
        super._update(from, to, netAmount);
        emit TaxRouted(
            from,
            to,
            platformAmount,
            marketingAmount,
            lpBlackHoleAmount,
            dividendAmount,
            burnAmount,
            netAmount
        );
    }
}
