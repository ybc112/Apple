// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AppleToken } from "./AppleToken.sol";
import { AppleMintVault } from "./AppleMintVault.sol";

contract AppleTokenDeployer is Ownable {
    address public factory;

    error FactoryAlreadySet();
    error NotFactory();
    error ZeroAddress();

    constructor() Ownable(msg.sender) {}

    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) {
            revert FactoryAlreadySet();
        }
        if (factory_ == address(0)) {
            revert ZeroAddress();
        }

        factory = factory_;
    }

    function deploy(
        AppleToken.LaunchConfig calldata launchConfig,
        AppleToken.TaxConfig calldata taxConfig,
        address initialHolder,
        bytes32 salt
    )
        external
        returns (address token)
    {
        if (msg.sender != factory) {
            revert NotFactory();
        }

        token = address(new AppleToken{ salt: salt }(launchConfig, taxConfig, initialHolder));
    }
}

contract AppleMintVaultDeployer is Ownable {
    address public factory;

    error FactoryAlreadySet();
    error NotFactory();
    error ZeroAddress();

    constructor() Ownable(msg.sender) {}

    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) {
            revert FactoryAlreadySet();
        }
        if (factory_ == address(0)) {
            revert ZeroAddress();
        }

        factory = factory_;
    }

    function deploy(
        address token,
        address liquidityRouter,
        address paymentToken,
        address owner,
        address receiver,
        uint256 totalSupply,
        uint256 totalMints,
        uint256 mintPrice,
        uint256 maxMintPerWallet,
        uint256 whitelistMintLimit,
        bool whitelistEnabled,
        bytes32 salt
    )
        external
        returns (address vault)
    {
        if (msg.sender != factory) {
            revert NotFactory();
        }

        vault = address(new AppleMintVault{ salt: salt }(
            token,
            liquidityRouter,
            paymentToken,
            owner,
            receiver,
            totalSupply,
            totalMints,
            mintPrice,
            maxMintPerWallet,
            whitelistMintLimit,
            whitelistEnabled
        ));
    }
}
