// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPancakePair is ERC20 {
    address public immutable token0;
    address public immutable token1;
    uint112 private _reserve0;
    uint112 private _reserve1;

    constructor(address token0_, address token1_) ERC20("Mock LP", "MLP") {
        token0 = token0_;
        token1 = token1_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        return (_reserve0, _reserve1, uint32(block.timestamp));
    }

    function sync(address wrappedNative) external {
        _reserve0 = uint112(_assetBalance(token0, wrappedNative));
        _reserve1 = uint112(_assetBalance(token1, wrappedNative));
    }

    function burnLiquidity(address token, address to, uint256 liquidity)
        external
        returns (uint256 tokenAmount, uint256 nativeAmount)
    {
        uint256 supply = totalSupply();
        tokenAmount = (IERC20(token).balanceOf(address(this)) * liquidity) / supply;
        nativeAmount = (address(this).balance * liquidity) / supply;

        _burn(address(this), liquidity);
        payable(to).transfer(nativeAmount);
        IERC20(token).transfer(to, tokenAmount);
        this.sync(token0 == token ? token1 : token0);
    }

    function burnLiquidityTokens(address tokenA, address tokenB, address to, uint256 liquidity)
        external
        returns (uint256 amountA, uint256 amountB)
    {
        uint256 supply = totalSupply();
        amountA = (IERC20(tokenA).balanceOf(address(this)) * liquidity) / supply;
        amountB = (IERC20(tokenB).balanceOf(address(this)) * liquidity) / supply;

        _burn(address(this), liquidity);
        IERC20(tokenA).transfer(to, amountA);
        IERC20(tokenB).transfer(to, amountB);
        this.sync(address(0));
    }

    function _assetBalance(address asset, address wrappedNative) private view returns (uint256) {
        if (asset == wrappedNative) {
            return address(this).balance;
        }

        return IERC20(asset).balanceOf(address(this));
    }

    receive() external payable {}
}

contract MockPancakeFactory {
    mapping(address tokenA => mapping(address tokenB => address pair)) public getPair;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        pair = getPair[tokenA][tokenB];
        if (pair != address(0)) {
            return pair;
        }

        pair = address(new MockPancakePair(tokenA, tokenB));
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
    }
}

contract MockPancakeRouter {
    address public immutable WETH;
    MockPancakeFactory private immutable _factory;

    constructor() {
        WETH = address(new MockWBNB());
        _factory = new MockPancakeFactory();
    }

    function factory() external view returns (address) {
        return address(_factory);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256,
        address[] calldata path,
        address to,
        uint256
    )
        external
    {
        address pairedAsset = path.length > 2 ? path[1] : WETH;
        address pair = _factory.getPair(path[0], pairedAsset);
        if (pair == address(0)) {
            IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        } else {
            IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
            _assertPairInput(pair, path[0]);
            MockPancakePair(payable(pair)).sync(WETH);
        }

        (bool sent,) = payable(to).call{ value: amountIn }("");
        require(sent, "NATIVE_SEND_FAILED");
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256,
        address[] calldata path,
        address to,
        uint256
    )
        external
    {
        address pair = _factory.getPair(path[0], path[1]);
        if (pair == address(0)) {
            IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        } else {
            IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
            _assertPairInput(pair, path[0]);
            MockPancakePair(payable(pair)).sync(path[1]);
        }

        MockRewardToken(path[path.length - 1]).mint(to, amountIn);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256,
        uint256,
        address to,
        uint256
    )
        external
        payable
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
    {
        address pair = _factory.getPair(token, WETH);
        if (pair == address(0)) {
            pair = _factory.createPair(token, WETH);
        }

        payable(pair).transfer(msg.value);
        IERC20(token).transferFrom(msg.sender, pair, amountTokenDesired);

        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = msg.value > 0 ? msg.value : amountTokenDesired;
        MockPancakePair(payable(pair)).mint(to, liquidity);
        MockPancakePair(payable(pair)).sync(WETH);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256,
        uint256,
        address to,
        uint256
    )
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address pair = _factory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = _factory.createPair(tokenA, tokenB);
        }

        IERC20(tokenA).transferFrom(msg.sender, pair, amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, pair, amountBDesired);

        amountA = amountADesired;
        amountB = amountBDesired;
        liquidity = amountBDesired > 0 ? amountBDesired : amountADesired;
        MockPancakePair(payable(pair)).mint(to, liquidity);
        MockPancakePair(payable(pair)).sync(address(0));
    }

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint256 liquidity,
        uint256,
        uint256,
        address to,
        uint256
    )
        external
        returns (uint256 amountETH)
    {
        address pair = _factory.getPair(token, WETH);
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        MockPancakePair(payable(pair)).burnLiquidity(token, address(this), liquidity);
        uint256 tokenReceived = IERC20(token).balanceOf(address(this)) - tokenBefore;
        amountETH = address(this).balance - nativeBefore;
        IERC20(token).transfer(to, tokenReceived);
        (bool sent,) = payable(to).call{ value: amountETH }("");
        require(sent, "NATIVE_SEND_FAILED");
        MockPancakePair(payable(pair)).sync(WETH);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256,
        uint256,
        address to,
        uint256
    )
        external
        returns (uint256 amountA, uint256 amountB)
    {
        address pair = _factory.getPair(tokenA, tokenB);
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        (amountA, amountB) =
            MockPancakePair(payable(pair)).burnLiquidityTokens(tokenA, tokenB, to, liquidity);
        MockPancakePair(payable(pair)).sync(address(0));
    }

    function _assertPairInput(address pair, address inputToken) private view {
        (uint112 reserve0, uint112 reserve1,) = MockPancakePair(payable(pair)).getReserves();
        uint256 reserveInput = MockPancakePair(payable(pair)).token0() == inputToken
            ? uint256(reserve0)
            : uint256(reserve1);
        uint256 balanceInput = IERC20(inputToken).balanceOf(pair);
        require(balanceInput > reserveInput, "PancakeLibrary: INSUFFICIENT_INPUT_AMOUNT");
    }

    receive() external payable {}
}

contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}
}

contract MockRewardToken is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
