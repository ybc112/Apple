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
    uint256 public immutable whitelistMintLimit;
    uint256 public immutable publicMintLimit;
    uint256 public immutable mintPrice;
    uint256 public immutable tokensPerMint;
    uint256 public mintedCount;
    uint256 public whitelistMintedCount;
    uint256 public publicMintedCount;
    bool public paused;
    bool public whitelistEnabled;

    mapping(address account => uint256 allowance) public whitelistAllowance;
    mapping(address account => uint256 minted) public whitelistMintedByWallet;
    mapping(address account => uint256 mintedByWallet) public mintedByWallet;

    error InvalidQuantity();
    error MintSoldOut();
    error IncorrectPayment();
    error ZeroAddress();
    error Paused();
    error NotWhitelisted();
    error LengthMismatch();

    event Minted(
        address indexed minter,
        uint256 quantity,
        uint256 whitelistQuantity,
        uint256 publicQuantity,
        uint256 tokenAmount,
        uint256 paid
    );
    event ReceiverUpdated(address indexed receiver);
    event PausedUpdated(bool paused);
    event WhitelistEnabledUpdated(bool enabled);
    event WhitelistAllowanceUpdated(address indexed account, uint256 allowance);

    constructor(
        address token_,
        address paymentToken_,
        address owner_,
        address receiver_,
        uint256 totalSupply_,
        uint256 totalMints_,
        uint256 mintPrice_,
        uint256 whitelistMintLimit_,
        bool whitelistEnabled_
    )
        Ownable(owner_)
    {
        if (token_ == address(0) || owner_ == address(0) || receiver_ == address(0) || totalMints_ == 0) {
            revert ZeroAddress();
        }
        if (whitelistMintLimit_ > totalMints_) {
            revert InvalidQuantity();
        }

        uint256 perMint = totalSupply_ / totalMints_;
        if (perMint == 0) {
            revert InvalidQuantity();
        }

        token = IERC20(token_);
        paymentToken = paymentToken_;
        receiver = receiver_;
        totalMints = totalMints_;
        whitelistMintLimit = whitelistMintLimit_;
        publicMintLimit = totalMints_ - whitelistMintLimit_;
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
        (uint256 whitelistQuantity, uint256 publicQuantity) = _consumeMintQuota(msg.sender, quantity);

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
        emit Minted(msg.sender, quantity, whitelistQuantity, publicQuantity, tokenAmount, cost);
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
        uint256 minted = whitelistMintedByWallet[account];
        uint256 remainingLimit = whitelistMintLimit > whitelistMintedCount
            ? whitelistMintLimit - whitelistMintedCount
            : 0;

        if (minted >= allowance) {
            return 0;
        }

        uint256 remainingAllowance = allowance - minted;
        return remainingAllowance < remainingLimit ? remainingAllowance : remainingLimit;
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

    function _consumeMintQuota(address minter, uint256 quantity)
        private
        returns (uint256 whitelistQuantity, uint256 publicQuantity)
    {
        uint256 remainingQuantity = quantity;

        if (whitelistEnabled && whitelistMintedCount < whitelistMintLimit) {
            uint256 allowance = whitelistAllowance[minter];
            uint256 usedAllowance = whitelistMintedByWallet[minter];

            if (allowance > usedAllowance) {
                uint256 remainingAllowance = allowance - usedAllowance;
                uint256 remainingWhitelistSlots = whitelistMintLimit - whitelistMintedCount;
                whitelistQuantity = _min(remainingQuantity, _min(remainingAllowance, remainingWhitelistSlots));
                remainingQuantity -= whitelistQuantity;
            }
        }

        publicQuantity = remainingQuantity;
        if (publicMintedCount + publicQuantity > publicMintLimit) {
            if (whitelistEnabled && whitelistQuantity == 0) {
                revert NotWhitelisted();
            }
            revert MintSoldOut();
        }

        mintedCount += quantity;
        mintedByWallet[minter] += quantity;

        if (whitelistQuantity > 0) {
            whitelistMintedCount += whitelistQuantity;
            whitelistMintedByWallet[minter] += whitelistQuantity;
        }
        if (publicQuantity > 0) {
            publicMintedCount += publicQuantity;
        }
    }

    function _min(uint256 left, uint256 right) private pure returns (uint256) {
        return left < right ? left : right;
    }

    receive() external payable {}
}
