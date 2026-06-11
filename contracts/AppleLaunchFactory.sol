// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { AppleToken } from "./AppleToken.sol";
import { AppleMintVault } from "./AppleMintVault.sol";

interface IAppleTokenDeployer {
    function deploy(
        AppleToken.LaunchConfig calldata launchConfig,
        AppleToken.TaxConfig calldata taxConfig,
        address initialHolder,
        bytes32 salt
    )
        external
        returns (address token);
}

interface IAppleMintVaultDeployer {
    function deploy(
        address token,
        address liquidityRouter,
        address paymentToken,
        address owner,
        address receiver,
        uint256 totalSupply,
        uint256 totalMints,
        uint256 mintPrice,
        uint256 whitelistMintLimit,
        bool whitelistEnabled,
        bytes32 salt
    )
        external
        returns (address vault);
}

contract AppleLaunchFactory is Ownable, ReentrancyGuard {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_TAX_BPS = 2_500;
    address public constant DEFAULT_REWARD_TOKEN = 0x55d398326f99059fF775485246999027B3197955;

    uint256 public creationFee;
    address public feeRecipient;
    address public liquidityRouter;
    address public tokenDeployer;
    address public vaultDeployer;
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
        uint256 whitelistMintCount;
        bool whitelistEnabled;
    }

    struct Project {
        address creator;
        address token;
        address vault;
        address paymentToken;
        address receiver;
        address platformFeeReceiver;
        bytes32 templateId;
        uint256 totalSupply;
        uint256 mintCount;
        uint256 whitelistMintCount;
        uint256 publicMintCount;
        uint256 mintPrice;
        bool whitelistEnabled;
        string metadataUri;
        uint64 createdAt;
        address rewardToken;
        uint256 rewardThreshold;
        uint16 buyTaxBps;
        uint16 sellTaxBps;
        uint16 fundFeeBps;
        uint16 lpFeeBps;
        uint16 dividendFeeBps;
        uint16 burnFeeBps;
    }

    mapping(address token => Project project) public projects;
    mapping(address creator => address[] tokens) private _creatorTokens;
    mapping(bytes32 templateId => address[] tokens) private _templateTokens;

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
    event ProjectIndexed(
        address indexed creator,
        bytes32 indexed templateId,
        address indexed token,
        address vault
    );

    constructor(
        address feeRecipient_,
        uint256 creationFee_,
        address liquidityRouter_,
        address tokenDeployer_,
        address vaultDeployer_
    )
        Ownable(msg.sender)
    {
        if (
            feeRecipient_ == address(0) || liquidityRouter_ == address(0)
                || tokenDeployer_ == address(0) || vaultDeployer_ == address(0)
        ) {
            revert ZeroAddress();
        }

        feeRecipient = feeRecipient_;
        liquidityRouter = liquidityRouter_;
        tokenDeployer = tokenDeployer_;
        vaultDeployer = vaultDeployer_;
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
        address rewardToken = params.rewardToken == address(0)
            ? DEFAULT_REWARD_TOKEN
            : params.rewardToken;

        AppleToken launchToken = AppleToken(IAppleTokenDeployer(tokenDeployer).deploy(
            AppleToken.LaunchConfig({
                name: params.name,
                symbol: params.symbol,
                projectUri: params.metadataUri,
                templateId: params.templateId,
                receiver: params.receiver,
                platformFeeReceiver: feeRecipient,
                paymentToken: params.paymentToken,
                rewardToken: rewardToken,
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
            address(this),
            tokenSalt
        ));

        AppleMintVault mintVault = AppleMintVault(payable(IAppleMintVaultDeployer(vaultDeployer).deploy(
            address(launchToken),
            liquidityRouter,
            params.paymentToken,
            msg.sender,
            params.receiver,
            params.totalSupply,
            params.mintCount,
            params.mintPrice,
            params.whitelistMintCount,
            params.whitelistEnabled,
            keccak256(abi.encodePacked(tokenSalt, "VAULT"))
        )));

        token = address(launchToken);
        vault = address(mintVault);

        launchToken.setLaunchVault(vault);
        launchToken.transfer(vault, params.totalSupply);
        launchToken.transferOwnership(msg.sender);

        projects[token] = Project({
            creator: msg.sender,
            token: token,
            vault: vault,
            paymentToken: params.paymentToken,
            receiver: params.receiver,
            platformFeeReceiver: feeRecipient,
            templateId: params.templateId,
            totalSupply: params.totalSupply,
            mintCount: params.mintCount,
            whitelistMintCount: params.whitelistMintCount,
            publicMintCount: params.mintCount - params.whitelistMintCount,
            mintPrice: params.mintPrice,
            whitelistEnabled: params.whitelistEnabled,
            metadataUri: params.metadataUri,
            createdAt: uint64(block.timestamp),
            rewardToken: rewardToken,
            rewardThreshold: params.rewardThreshold,
            buyTaxBps: params.buyTaxBps,
            sellTaxBps: params.sellTaxBps,
            fundFeeBps: params.fundFeeBps,
            lpFeeBps: params.lpFeeBps,
            dividendFeeBps: params.dividendFeeBps,
            burnFeeBps: params.burnFeeBps
        });
        allTokens.push(token);
        _creatorTokens[msg.sender].push(token);
        _templateTokens[params.templateId].push(token);

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
        emit ProjectIndexed(msg.sender, params.templateId, token, vault);
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function creatorTokensLength(address creator) external view returns (uint256) {
        return _creatorTokens[creator].length;
    }

    function creatorTokenAt(address creator, uint256 index) external view returns (address) {
        return _creatorTokens[creator][index];
    }

    function templateTokensLength(bytes32 templateId) external view returns (uint256) {
        return _templateTokens[templateId].length;
    }

    function templateTokenAt(bytes32 templateId, uint256 index) external view returns (address) {
        return _templateTokens[templateId][index];
    }

    function getProject(address token) external view returns (Project memory) {
        return projects[token];
    }

    function getProjects(uint256 offset, uint256 limit) external view returns (Project[] memory items) {
        uint256 length = allTokens.length;
        if (offset >= length || limit == 0) {
            return new Project[](0);
        }

        uint256 end = offset + limit;
        if (end > length || end < offset) {
            end = length;
        }

        items = new Project[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            items[i - offset] = projects[allTokens[i]];
        }
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
                || params.totalSupply < params.mintCount || params.whitelistMintCount > params.mintCount
        ) {
            revert InvalidParams();
        }

        uint256 splitTotal = uint256(params.fundFeeBps) + params.lpFeeBps + params.dividendFeeBps
            + params.burnFeeBps;

        if (
            params.buyTaxBps > MAX_TAX_BPS || params.sellTaxBps > MAX_TAX_BPS
                || splitTotal > BPS_DENOMINATOR
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
