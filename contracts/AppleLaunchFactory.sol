// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { AppleToken } from "./AppleToken.sol";
import { AppleMintVault } from "./AppleMintVault.sol";

contract AppleLaunchFactory is Ownable, ReentrancyGuard {
    uint256 public creationFee;
    address public feeRecipient;
    address[] public allTokens;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataUri;
        uint256 totalSupply;
        uint256 mintCount;
        uint256 mintPrice;
        address paymentToken;
        address rewardToken;
        uint256 rewardThreshold;
        address receiver;
        bytes32 templateId;
        uint16 buyTaxBps;
        uint16 sellTaxBps;
        uint16 fundFeeBps;
        uint16 lpFeeBps;
        uint16 dividendFeeBps;
        uint16 burnFeeBps;
        bool whitelistEnabled;
    }

    struct Project {
        address creator;
        address token;
        address vault;
        address paymentToken;
        address receiver;
        bytes32 templateId;
        uint256 totalSupply;
        uint256 mintCount;
        uint256 mintPrice;
        bool whitelistEnabled;
        string metadataUri;
        uint64 createdAt;
    }

    mapping(address token => Project project) public projects;

    error InvalidFee();
    error InvalidParams();
    error ZeroAddress();

    event LaunchCreated(
        address indexed creator,
        address indexed token,
        address indexed vault,
        bytes32 templateId,
        string name,
        string symbol,
        uint256 totalSupply,
        uint256 mintCount,
        uint256 mintPrice,
        address paymentToken,
        bool whitelistEnabled,
        string metadataUri
    );
    event CreationFeeUpdated(uint256 creationFee);
    event FeeRecipientUpdated(address indexed feeRecipient);

    constructor(address feeRecipient_, uint256 creationFee_) Ownable(msg.sender) {
        if (feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }

        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    function createLaunch(LaunchParams calldata params, bytes32 salt)
        external
        payable
        nonReentrant
        returns (address token, address vault)
    {
        _validateParams(params);
        _collectCreationFee();

        bytes32 tokenSalt = keccak256(
            abi.encodePacked(msg.sender, salt, params.name, params.symbol, block.chainid)
        );

        AppleToken launchToken = new AppleToken{ salt: tokenSalt }(
            AppleToken.LaunchConfig({
                name: params.name,
                symbol: params.symbol,
                projectUri: params.metadataUri,
                templateId: params.templateId,
                receiver: params.receiver,
                paymentToken: params.paymentToken,
                rewardToken: params.rewardToken,
                rewardThreshold: params.rewardThreshold,
                totalSupply: params.totalSupply
            }),
            AppleToken.TaxConfig({
                buyTaxBps: params.buyTaxBps,
                sellTaxBps: params.sellTaxBps,
                fundFeeBps: params.fundFeeBps,
                lpFeeBps: params.lpFeeBps,
                dividendFeeBps: params.dividendFeeBps,
                burnFeeBps: params.burnFeeBps
            }),
            address(this)
        );

        AppleMintVault mintVault = new AppleMintVault{
            salt: keccak256(abi.encodePacked(tokenSalt, "VAULT"))
        }(
            address(launchToken),
            params.paymentToken,
            params.receiver,
            params.totalSupply,
            params.mintCount,
            params.mintPrice,
            params.whitelistEnabled
        );

        token = address(launchToken);
        vault = address(mintVault);

        launchToken.setLaunchVault(vault);
        launchToken.transfer(vault, params.totalSupply);
        launchToken.transferOwnership(params.receiver);

        projects[token] = Project({
            creator: msg.sender,
            token: token,
            vault: vault,
            paymentToken: params.paymentToken,
            receiver: params.receiver,
            templateId: params.templateId,
            totalSupply: params.totalSupply,
            mintCount: params.mintCount,
            mintPrice: params.mintPrice,
            whitelistEnabled: params.whitelistEnabled,
            metadataUri: params.metadataUri,
            createdAt: uint64(block.timestamp)
        });
        allTokens.push(token);

        emit LaunchCreated(
            msg.sender,
            token,
            vault,
            params.templateId,
            params.name,
            params.symbol,
            params.totalSupply,
            params.mintCount,
            params.mintPrice,
            params.paymentToken,
            params.whitelistEnabled,
            params.metadataUri
        );
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function setCreationFee(uint256 nextFee) external onlyOwner {
        creationFee = nextFee;
        emit CreationFeeUpdated(nextFee);
    }

    function setFeeRecipient(address nextFeeRecipient) external onlyOwner {
        if (nextFeeRecipient == address(0)) {
            revert ZeroAddress();
        }

        feeRecipient = nextFeeRecipient;
        emit FeeRecipientUpdated(nextFeeRecipient);
    }

    function _validateParams(LaunchParams calldata params) private pure {
        if (
            bytes(params.name).length == 0 || bytes(params.symbol).length == 0
                || params.totalSupply == 0 || params.mintCount == 0 || params.receiver == address(0)
        ) {
            revert InvalidParams();
        }
    }

    function _collectCreationFee() private {
        if (msg.value < creationFee) {
            revert InvalidFee();
        }

        if (creationFee > 0) {
            (bool paid,) = payable(feeRecipient).call{ value: creationFee }("");
            if (!paid) {
                revert InvalidFee();
            }
        }

        uint256 refund = msg.value - creationFee;
        if (refund > 0) {
            (bool refunded,) = payable(msg.sender).call{ value: refund }("");
            if (!refunded) {
                revert InvalidFee();
            }
        }
    }
}
