// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract AppleToken is ERC20, Ownable {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_TAX_BPS = 2_500;

    string public projectUri;
    bytes32 public templateId;
    address public factory;
    address public launchVault;
    address public receiver;
    address public paymentToken;
    address public rewardToken;
    uint256 public rewardThreshold;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public fundFeeBps;
    uint16 public lpFeeBps;
    uint16 public dividendFeeBps;
    uint16 public burnFeeBps;

    mapping(address account => bool enabled) public isTaxExempt;
    mapping(address pair => bool enabled) public automatedMarketMakerPairs;

    error InvalidTax();
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
        address paymentToken;
        address rewardToken;
        uint256 rewardThreshold;
        uint256 totalSupply;
    }

    event LaunchVaultSet(address indexed vault);
    event TaxConfigUpdated(uint16 buyTaxBps, uint16 sellTaxBps);
    event TaxExemptUpdated(address indexed account, bool enabled);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool enabled);

    constructor(
        LaunchConfig memory launchConfig,
        TaxConfig memory taxConfig,
        address initialHolder
    )
        ERC20(launchConfig.name, launchConfig.symbol)
        Ownable(msg.sender)
    {
        if (launchConfig.receiver == address(0) || initialHolder == address(0)) {
            revert ZeroAddress();
        }

        factory = msg.sender;
        projectUri = launchConfig.projectUri;
        templateId = launchConfig.templateId;
        receiver = launchConfig.receiver;
        paymentToken = launchConfig.paymentToken;
        rewardToken = launchConfig.rewardToken;
        rewardThreshold = launchConfig.rewardThreshold;

        _setTaxes(taxConfig);
        isTaxExempt[msg.sender] = true;
        isTaxExempt[initialHolder] = true;
        isTaxExempt[launchConfig.receiver] = true;

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

    function setTaxes(TaxConfig calldata taxConfig) external onlyOwner {
        _setTaxes(taxConfig);
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

        emit TaxConfigUpdated(taxConfig.buyTaxBps, taxConfig.sellTaxBps);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (
            from == address(0) || to == address(0) || value == 0 || isTaxExempt[from]
                || isTaxExempt[to]
        ) {
            super._update(from, to, value);
            return;
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

        uint256 splitTotal = uint256(fundFeeBps) + lpFeeBps + dividendFeeBps + burnFeeBps;
        uint256 burnAmount = splitTotal == 0 ? 0 : (fee * burnFeeBps) / splitTotal;
        uint256 receiverAmount = fee - burnAmount;

        if (receiverAmount > 0) {
            super._update(from, receiver, receiverAmount);
        }
        if (burnAmount > 0) {
            super._update(from, address(0), burnAmount);
        }

        super._update(from, to, value - fee);
    }
}
