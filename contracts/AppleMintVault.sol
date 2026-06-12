// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILaunchToken is IERC20 {
    function finalizeLaunch(address pair) external;
}

interface IPancakeV2Router {
    function WETH() external view returns (address);
    function factory() external view returns (address);
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
    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        returns (uint256 amountETH);
}

interface IPancakeV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract AppleMintVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant LIQUIDITY_TOKEN_BPS = 5_000;
    uint256 public constant REFUND_WINDOW = 24 hours;
    address public constant PERMISSION_BLACK_HOLE = 0x000000000000000000000000000000000000dEaD;

    ILaunchToken public immutable token;
    IPancakeV2Router public immutable liquidityRouter;
    address public immutable paymentToken;
    address public receiver;
    uint256 public immutable totalMints;
    uint256 public immutable whitelistMintLimit;
    uint256 public immutable publicMintLimit;
    uint256 public immutable mintPrice;
    uint256 public immutable maxMintPerWallet;
    uint256 public immutable tokensPerMint;
    uint256 public immutable tokensForSale;
    uint256 public immutable liquidityTokenReserve;
    uint256 public mintedCount;
    uint256 public whitelistMintedCount;
    uint256 public publicMintedCount;
    uint256 public refundedCount;
    uint256 public refundedPayment;
    uint256 public distributedTokenAmount;
    uint256 public liquidityAddedToken;
    uint256 public liquidityAddedNative;
    uint256 public liquidityLpAmount;
    uint256 public whitelistAccountCount;
    uint256 public immutable refundDeadline;
    address public liquidityPair;
    bool public finalized;
    bool public whitelistEnabled;

    mapping(address account => bool listed) public whitelistList;
    mapping(address account => uint256 minted) public whitelistMintedByWallet;
    mapping(address account => uint256 mintedByWallet) public mintedByWallet;
    mapping(address account => uint256 paid) public paidByWallet;
    mapping(address account => uint256 liquidity) public liquidityLpByWallet;

    error InvalidQuantity();
    error MintSoldOut();
    error IncorrectPayment();
    error LaunchExpired();
    error LaunchAlreadyFinalized();
    error NoRefund();
    error RefundUnavailable();
    error ZeroAddress();
    error NotWhitelisted();
    error LengthMismatch();
    error DirectNativePayment();
    error NotLaunchToken();
    error WalletMintLimitExceeded();

    event Minted(
        address indexed minter,
        uint256 quantity,
        uint256 whitelistQuantity,
        uint256 publicQuantity,
        uint256 tokenAmount,
        uint256 paid
    );
    event ReceiverUpdated(address indexed receiver);
    event LaunchFinalized(uint256 paidOut);
    event LiquidityAdded(
        address indexed pair,
        uint256 tokenAmount,
        uint256 nativeAmount,
        uint256 liquidity
    );
    event Refunded(address indexed account, uint256 quantity, uint256 tokenAmount, uint256 paid);
    event WhitelistEnabledUpdated(bool enabled);
    event WhitelistListUpdated(address indexed account, bool listed);

    constructor(
        address token_,
        address liquidityRouter_,
        address paymentToken_,
        address owner_,
        address receiver_,
        uint256 totalSupply_,
        uint256 totalMints_,
        uint256 mintPrice_,
        uint256 maxMintPerWallet_,
        uint256 whitelistMintLimit_,
        bool whitelistEnabled_
    )
        Ownable(owner_)
    {
        if (
            token_ == address(0) || liquidityRouter_ == address(0) || owner_ == address(0)
                || receiver_ == address(0) || totalMints_ == 0
        ) {
            revert ZeroAddress();
        }
        if (whitelistMintLimit_ > totalMints_) {
            revert InvalidQuantity();
        }
        if (paymentToken_ != address(0)) {
            revert IncorrectPayment();
        }

        uint256 reserve = (totalSupply_ * LIQUIDITY_TOKEN_BPS) / BPS_DENOMINATOR;
        uint256 saleSupply = totalSupply_ - reserve;
        uint256 perMint = saleSupply / totalMints_;
        if (perMint == 0) {
            revert InvalidQuantity();
        }

        token = ILaunchToken(token_);
        liquidityRouter = IPancakeV2Router(liquidityRouter_);
        paymentToken = paymentToken_;
        receiver = receiver_;
        totalMints = totalMints_;
        whitelistMintLimit = whitelistMintLimit_;
        publicMintLimit = totalMints_ - whitelistMintLimit_;
        mintPrice = mintPrice_;
        maxMintPerWallet = maxMintPerWallet_;
        tokensPerMint = perMint;
        tokensForSale = saleSupply;
        liquidityTokenReserve = reserve;
        refundDeadline = block.timestamp + REFUND_WINDOW;
        whitelistEnabled = whitelistEnabled_;
    }

    function mint(uint256 quantity) external payable nonReentrant {
        _mintFor(msg.sender, quantity);
    }

    function mintFor(address minter, uint256 quantity) external payable nonReentrant {
        if (msg.sender != address(token)) {
            revert NotLaunchToken();
        }
        if (minter == address(0)) {
            revert ZeroAddress();
        }

        _mintFor(minter, quantity);
    }

    function _mintFor(address minter, uint256 quantity) private {
        if (finalized) {
            revert LaunchAlreadyFinalized();
        }
        if (block.timestamp >= refundDeadline) {
            revert LaunchExpired();
        }
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (mintedCount + quantity > totalMints) {
            revert MintSoldOut();
        }
        if (
            maxMintPerWallet > 0
                && mintedByWallet[minter] + quantity > maxMintPerWallet
        ) {
            revert WalletMintLimitExceeded();
        }

        uint256 cost = quote(quantity);
        (uint256 whitelistQuantity, uint256 publicQuantity) = _consumeMintQuota(minter, quantity);

        uint256 tokenAmount = tokensPerMint * quantity;
        if (mintedCount == totalMints) {
            tokenAmount = tokensForSale - distributedTokenAmount;
        }
        distributedTokenAmount += tokenAmount;

        if (msg.value != cost) {
            revert IncorrectPayment();
        }

        paidByWallet[minter] += cost;
        IERC20(address(token)).safeTransfer(minter, tokenAmount);
        _addMintLiquidity(minter, quantity, cost);
        emit Minted(minter, quantity, whitelistQuantity, publicQuantity, tokenAmount, cost);

        if (mintedCount == totalMints) {
            _finalizeLaunch();
        }
    }

    function quote(uint256 quantity) public view returns (uint256) {
        return mintPrice * quantity;
    }

    function progressBps() external view returns (uint256) {
        return (mintedCount * 10_000) / totalMints;
    }

    function canRefund(address account) external view returns (bool) {
        return !finalized && block.timestamp >= refundDeadline && paidByWallet[account] > 0;
    }

    function claimRefund() external nonReentrant {
        if (finalized) {
            revert LaunchAlreadyFinalized();
        }
        if (block.timestamp < refundDeadline || mintedCount == totalMints) {
            revert RefundUnavailable();
        }

        uint256 paid = paidByWallet[msg.sender];
        uint256 quantity = mintedByWallet[msg.sender];
        if (paid == 0 || quantity == 0) {
            revert NoRefund();
        }

        uint256 tokenAmount = tokensPerMint * quantity;
        uint256 whitelistQuantity = whitelistMintedByWallet[msg.sender];
        if (whitelistQuantity > quantity) {
            whitelistQuantity = quantity;
        }
        uint256 publicQuantity = quantity - whitelistQuantity;

        paidByWallet[msg.sender] = 0;
        mintedByWallet[msg.sender] = 0;
        whitelistMintedByWallet[msg.sender] = 0;
        mintedCount -= quantity;
        if (whitelistQuantity > 0) {
            whitelistMintedCount -= whitelistQuantity;
        }
        if (publicQuantity > 0) {
            publicMintedCount -= publicQuantity;
        }
        refundedCount += quantity;
        distributedTokenAmount = distributedTokenAmount >= tokenAmount
            ? distributedTokenAmount - tokenAmount
            : 0;

        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), tokenAmount);

        _removeWalletLiquidity(msg.sender);
        uint256 refundAmount = paid < address(this).balance ? paid : address(this).balance;
        if (refundAmount == 0) {
            revert NoRefund();
        }

        (bool sent,) = payable(msg.sender).call{ value: refundAmount }("");
        if (!sent) {
            revert IncorrectPayment();
        }
        refundedPayment += refundAmount;

        emit Refunded(msg.sender, quantity, tokenAmount, paid);
    }

    function setWhitelistEnabled(bool nextWhitelistEnabled) external onlyOwner {
        whitelistEnabled = nextWhitelistEnabled;
        emit WhitelistEnabledUpdated(nextWhitelistEnabled);
    }

    function setWhitelistAccount(address account, bool listed) external onlyOwner {
        if (account == address(0)) {
            revert ZeroAddress();
        }

        _setWhitelistAccount(account, listed);
    }

    function setWhitelistAllowance(address account, uint256 allowance) external onlyOwner {
        if (account == address(0)) {
            revert ZeroAddress();
        }

        _setWhitelistAccount(account, allowance > 0);
    }

    function setWhitelistAccounts(address[] calldata accounts, bool listed) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) {
                revert ZeroAddress();
            }

            _setWhitelistAccount(accounts[i], listed);
        }
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

            _setWhitelistAccount(accounts[i], allowances[i] > 0);
        }
    }

    function totalWhitelistAllowance() external view returns (uint256) {
        return whitelistAccountCount;
    }

    function whitelistRemaining(address account) external view returns (uint256) {
        if (!whitelistList[account]) {
            return 0;
        }

        uint256 remainingLimit = whitelistMintLimit > whitelistMintedCount
            ? whitelistMintLimit - whitelistMintedCount
            : 0;

        return remainingLimit;
    }

    function _setWhitelistAccount(address account, bool listed) private {
        bool wasListed = whitelistList[account];
        if (wasListed == listed) {
            return;
        }

        if (listed) {
            whitelistAccountCount += 1;
        } else {
            whitelistAccountCount -= 1;
        }

        whitelistList[account] = listed;
        emit WhitelistListUpdated(account, listed);
    }

    function setReceiver(address nextReceiver) external onlyOwner {
        if (nextReceiver == address(0)) {
            revert ZeroAddress();
        }

        receiver = nextReceiver;
        emit ReceiverUpdated(nextReceiver);
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        if (!finalized) {
            revert RefundUnavailable();
        }

        (bool sent,) = payable(receiver).call{ value: amount }("");
        if (!sent) {
            revert IncorrectPayment();
        }
    }

    function _consumeMintQuota(address minter, uint256 quantity)
        private
        returns (uint256 whitelistQuantity, uint256 publicQuantity)
    {
        uint256 remainingQuantity = quantity;
        bool whitelistPhaseActive = whitelistEnabled && whitelistMintedCount < whitelistMintLimit;

        if (whitelistPhaseActive) {
            if (!whitelistList[minter]) {
                revert NotWhitelisted();
            }

            uint256 remainingWhitelistSlots = whitelistMintLimit - whitelistMintedCount;
            whitelistQuantity = _min(remainingQuantity, remainingWhitelistSlots);
            remainingQuantity -= whitelistQuantity;

            bool whitelistFilledAfterThisMint = whitelistMintedCount + whitelistQuantity >= whitelistMintLimit;
            if (remainingQuantity > 0 && !whitelistFilledAfterThisMint) {
                revert NotWhitelisted();
            }
        }

        publicQuantity = remainingQuantity;
        uint256 activePublicMintLimit = whitelistEnabled
            ? publicMintLimit
            : totalMints - whitelistMintedCount;
        if (publicMintedCount + publicQuantity > activePublicMintLimit) {
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

    function _finalizeLaunch() private {
        finalized = true;

        uint256 paidOut = liquidityAddedNative;
        token.finalizeLaunch(liquidityPair);
        _lockLiquidity();

        emit LaunchFinalized(paidOut);
        _transferOwnership(PERMISSION_BLACK_HOLE);
    }

    function _addMintLiquidity(address account, uint256 quantity, uint256 nativeAmount) private {
        uint256 tokenAmount = (liquidityTokenReserve * quantity) / totalMints;
        if (mintedCount == totalMints) {
            tokenAmount = liquidityTokenReserve - liquidityAddedToken;
        }

        if (nativeAmount == 0 || tokenAmount == 0) {
            return;
        }

        address routerFactory = liquidityRouter.factory();
        address pairedAsset = liquidityRouter.WETH();
        address pair = IPancakeV2Factory(routerFactory).getPair(address(token), pairedAsset);

        IERC20(address(token)).forceApprove(address(liquidityRouter), tokenAmount);
        uint256 amountToken;
        uint256 amountPayment;
        uint256 liquidity;
        (amountToken, amountPayment, liquidity) = liquidityRouter.addLiquidityETH{
            value: nativeAmount
        }(
            address(token),
            tokenAmount,
            0,
            0,
            address(this),
            block.timestamp
        );
        liquidityAddedNative += amountPayment;
        IERC20(address(token)).forceApprove(address(liquidityRouter), 0);

        if (pair == address(0)) {
            pair = IPancakeV2Factory(routerFactory).getPair(address(token), pairedAsset);
        }

        liquidityPair = pair;
        liquidityAddedToken += amountToken;
        liquidityLpAmount += liquidity;
        liquidityLpByWallet[account] += liquidity;

        emit LiquidityAdded(pair, amountToken, amountPayment, liquidity);
    }

    function _removeWalletLiquidity(address account) private {
        uint256 liquidity = liquidityLpByWallet[account];
        if (liquidity == 0 || liquidityPair == address(0)) {
            return;
        }

        liquidityLpByWallet[account] = 0;

        IERC20(liquidityPair).forceApprove(address(liquidityRouter), liquidity);
        uint256 tokenRecovered;
        uint256 paymentRecovered;
        uint256 tokenBefore = IERC20(address(token)).balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        liquidityRouter.removeLiquidityETHSupportingFeeOnTransferTokens(
            address(token),
            liquidity,
            0,
            0,
            address(this),
            block.timestamp
        );
        tokenRecovered = IERC20(address(token)).balanceOf(address(this)) - tokenBefore;
        paymentRecovered = address(this).balance - nativeBefore;
        liquidityAddedNative = liquidityAddedNative >= paymentRecovered
            ? liquidityAddedNative - paymentRecovered
            : 0;
        IERC20(liquidityPair).forceApprove(address(liquidityRouter), 0);

        liquidityLpAmount = liquidityLpAmount >= liquidity ? liquidityLpAmount - liquidity : 0;
        liquidityAddedToken = liquidityAddedToken >= tokenRecovered
            ? liquidityAddedToken - tokenRecovered
            : 0;
    }

    function _lockLiquidity() private {
        if (liquidityPair != address(0)) {
            uint256 lpBalance = IERC20(liquidityPair).balanceOf(address(this));
            if (lpBalance > 0) {
                IERC20(liquidityPair).safeTransfer(PERMISSION_BLACK_HOLE, lpBalance);
            }
        }

        uint256 leftoverToken = IERC20(address(token)).balanceOf(address(this));
        if (leftoverToken > 0) {
            IERC20(address(token)).safeTransfer(PERMISSION_BLACK_HOLE, leftoverToken);
        }

        uint256 leftoverNative = address(this).balance;
        if (leftoverNative > 0) {
            (bool sent,) = payable(receiver).call{ value: leftoverNative }("");
            if (!sent) {
                revert IncorrectPayment();
            }
        }
    }

    receive() external payable {
        if (msg.sender != address(liquidityRouter) && msg.sender != liquidityPair) {
            revert DirectNativePayment();
        }
    }
}
