// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPancakePair is ERC20 {
    constructor() ERC20("Mock LP", "MLP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnLiquidity(address token, address to, uint256 liquidity)
        external
        returns (uint256 tokenAmount, uint256 nativeAmount)
    {
        uint256 supply = totalSupply();
        tokenAmount = (IERC20(token).balanceOf(address(this)) * liquidity) / supply;
        nativeAmount = (address(this).balance * liquidity) / supply;

        _burn(address(this), liquidity);
        IERC20(token).transfer(to, tokenAmount);
        payable(to).transfer(nativeAmount);
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

        pair = address(new MockPancakePair());
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

        IERC20(token).transferFrom(msg.sender, pair, amountTokenDesired);
        payable(pair).transfer(msg.value);

        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = msg.value > 0 ? msg.value : amountTokenDesired;
        MockPancakePair(payable(pair)).mint(to, liquidity);
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
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        (, amountETH) = MockPancakePair(payable(pair)).burnLiquidity(token, to, liquidity);
    }
}

contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}
}
