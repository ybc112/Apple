// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AppleMintVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable paymentToken;
    address public receiver;
    uint256 public immutable totalMints;
    uint256 public immutable mintPrice;
    uint256 public immutable tokensPerMint;
    uint256 public mintedCount;
    bool public paused;
    bool public whitelistEnabled;

    mapping(address account => uint256 allowance) public whitelistAllowance;
    mapping(address account => uint256 mintedByWallet) public mintedByWallet;

    error InvalidQuantity();
    error MintSoldOut();
    error IncorrectPayment();
    error ZeroAddress();
    error Paused();
    error NotWhitelisted();
    error LengthMismatch();

    event Minted(address indexed minter, uint256 quantity, uint256 tokenAmount, uint256 paid);
    event ReceiverUpdated(address indexed receiver);
    event PausedUpdated(bool paused);
    event WhitelistEnabledUpdated(bool enabled);
    event WhitelistAllowanceUpdated(address indexed account, uint256 allowance);

    constructor(
        address token_,
        address paymentToken_,
        address receiver_,
        uint256 totalSupply_,
        uint256 totalMints_,
        uint256 mintPrice_,
        bool whitelistEnabled_
    )
        Ownable(receiver_)
    {
        if (token_ == address(0) || receiver_ == address(0) || totalMints_ == 0) {
            revert ZeroAddress();
        }

        uint256 perMint = totalSupply_ / totalMints_;
        if (perMint == 0) {
            revert InvalidQuantity();
        }

        token = IERC20(token_);
        paymentToken = paymentToken_;
        receiver = receiver_;
        totalMints = totalMints_;
        mintPrice = mintPrice_;
        tokensPerMint = perMint;
        whitelistEnabled = whitelistEnabled_;
    }

    function mint(uint256 quantity) external payable nonReentrant {
        if (paused) {
            revert Paused();
        }
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (mintedCount + quantity > totalMints) {
            revert MintSoldOut();
        }

        uint256 cost = quote(quantity);
        uint256 tokenAmount = tokensPerMint * quantity;
        mintedCount += quantity;
        mintedByWallet[msg.sender] += quantity;

        if (whitelistEnabled && mintedByWallet[msg.sender] > whitelistAllowance[msg.sender]) {
            revert NotWhitelisted();
        }

        if (mintedCount == totalMints) {
            tokenAmount = token.balanceOf(address(this));
        }

        if (paymentToken == address(0)) {
            if (msg.value != cost) {
                revert IncorrectPayment();
            }

            (bool sent,) = payable(receiver).call{ value: msg.value }("");
            if (!sent) {
                revert IncorrectPayment();
            }
        } else {
            if (msg.value != 0) {
                revert IncorrectPayment();
            }
            IERC20(paymentToken).safeTransferFrom(msg.sender, receiver, cost);
        }

        token.safeTransfer(msg.sender, tokenAmount);
        emit Minted(msg.sender, quantity, tokenAmount, cost);
    }

    function quote(uint256 quantity) public view returns (uint256) {
        return mintPrice * quantity;
    }

    function progressBps() external view returns (uint256) {
        return (mintedCount * 10_000) / totalMints;
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PausedUpdated(nextPaused);
    }

    function setWhitelistEnabled(bool nextWhitelistEnabled) external onlyOwner {
        whitelistEnabled = nextWhitelistEnabled;
        emit WhitelistEnabledUpdated(nextWhitelistEnabled);
    }

    function setWhitelistAllowance(address account, uint256 allowance) external onlyOwner {
        if (account == address(0)) {
            revert ZeroAddress();
        }

        whitelistAllowance[account] = allowance;
        emit WhitelistAllowanceUpdated(account, allowance);
    }

    function setWhitelistAllowances(
        address[] calldata accounts,
        uint256[] calldata allowances
    )
        external
        onlyOwner
    {
        if (accounts.length != allowances.length) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) {
                revert ZeroAddress();
            }

            whitelistAllowance[accounts[i]] = allowances[i];
            emit WhitelistAllowanceUpdated(accounts[i], allowances[i]);
        }
    }

    function whitelistRemaining(address account) external view returns (uint256) {
        uint256 allowance = whitelistAllowance[account];
        uint256 minted = mintedByWallet[account];

        return minted >= allowance ? 0 : allowance - minted;
    }

    function setReceiver(address nextReceiver) external onlyOwner {
        if (nextReceiver == address(0)) {
            revert ZeroAddress();
        }

        receiver = nextReceiver;
        emit ReceiverUpdated(nextReceiver);
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        (bool sent,) = payable(receiver).call{ value: amount }("");
        if (!sent) {
            revert IncorrectPayment();
        }
    }

    function withdrawPaymentToken(uint256 amount) external onlyOwner {
        if (paymentToken == address(0)) {
            revert ZeroAddress();
        }
        IERC20(paymentToken).safeTransfer(receiver, amount);
    }

    receive() external payable {}
}
