import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("AppleLaunchFactory", function () {
  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function deployFactory(requiredTokenSuffix = 0) {
    const [owner, creator, buyer, pair, dividendReceiver] = await ethers.getSigners();
    const creationFee = ethers.parseEther("0.005");
    const router = await ethers.deployContract("MockPancakeRouter");
    const tokenDeployer = await ethers.deployContract("AppleTokenDeployer");
    const vaultDeployer = await ethers.deployContract("AppleMintVaultDeployer");
    const factory = await ethers.deployContract("AppleLaunchFactory", [
      owner.address,
      creationFee,
      await router.getAddress(),
      await tokenDeployer.getAddress(),
      await vaultDeployer.getAddress(),
      requiredTokenSuffix,
    ]);
    await tokenDeployer.setFactory(await factory.getAddress());
    await vaultDeployer.setFactory(await factory.getAddress());

    return { owner, creator, buyer, pair, dividendReceiver, creationFee, factory, router, tokenDeployer };
  }

  async function getLiquidityPair(router: any, tokenAddress: string, pairedAsset?: string) {
    const pancakeFactory = await ethers.getContractAt(
      "MockPancakeFactory",
      await router.factory(),
    );
    return pancakeFactory.getPair(tokenAddress, pairedAsset ?? await router.WETH());
  }

  function launchParams(receiver: string) {
    return {
      name: "Apple Seed",
      symbol: "APPLE",
      metadataUri: "ipfs://apple-seed",
      totalSupply: ethers.parseUnits("1000000", 18),
      mintCount: 1000n,
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 0n,
      paymentToken: ethersLib.ZeroAddress,
      rewardToken: ethersLib.ZeroAddress,
      rewardThreshold: 0n,
      receiver,
      templateId: ethers.id("standard"),
      buyTaxBps: 300,
      sellTaxBps: 300,
      transferTaxBps: 0,
      addLiquidityTaxBps: 0,
      removeLiquidityTaxBps: 0,
      launchProtectionTaxBps: 0,
      launchProtectionBlocks: 0,
      claimWait: 0,
      fundFeeBps: 4400,
      lpFeeBps: 1800,
      dividendFeeBps: 1600,
      burnFeeBps: 1000,
      whitelistMintCount: 0n,
      whitelistEnabled: false,
    };
  }

  async function predictTokenAddress(
    tokenDeployerAddress: string,
    factoryAddress: string,
    creator: string,
    platformFeeReceiver: string,
    params: ReturnType<typeof launchParams>,
    salt: string,
  ) {
    const tokenFactory = await ethers.getContractFactory("AppleToken");
    const rewardToken = params.rewardToken === ethersLib.ZeroAddress
      ? "0x55d398326f99059fF775485246999027B3197955"
      : params.rewardToken;
    const deployTx = await tokenFactory.getDeployTransaction(
      {
        name: params.name,
        symbol: params.symbol,
        projectUri: params.metadataUri,
        templateId: params.templateId,
        receiver: params.receiver,
        platformFeeReceiver,
        paymentToken: params.paymentToken,
        rewardToken,
        rewardThreshold: params.rewardThreshold,
        totalSupply: params.totalSupply,
      },
      {
        buyTaxBps: params.buyTaxBps,
        sellTaxBps: params.sellTaxBps,
        transferTaxBps: params.transferTaxBps,
        addLiquidityTaxBps: params.addLiquidityTaxBps,
        removeLiquidityTaxBps: params.removeLiquidityTaxBps,
        launchProtectionTaxBps: params.launchProtectionTaxBps,
        launchProtectionBlocks: params.launchProtectionBlocks,
        claimWait: params.claimWait,
        fundFeeBps: params.fundFeeBps,
        lpFeeBps: params.lpFeeBps,
        dividendFeeBps: params.dividendFeeBps,
        burnFeeBps: params.burnFeeBps,
      },
      factoryAddress,
    );
    const networkInfo = await ethers.provider.getNetwork();
    const tokenSalt = ethersLib.solidityPackedKeccak256(
      ["address", "bytes32", "string", "string", "uint256"],
      [creator, salt, params.name, params.symbol, networkInfo.chainId],
    );

    if (!deployTx.data) {
      throw new Error("Missing AppleToken deploy data");
    }

    return ethersLib.getCreate2Address(tokenDeployerAddress, tokenSalt, ethersLib.keccak256(deployTx.data));
  }

  it("creates an independent token and mint vault after paying the launch fee", async function () {
    const { owner, creator, creationFee, factory, router } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-1"), { value: creationFee });

    expect(await factory.allTokensLength()).to.equal(1n);

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    const launchPair = await getLiquidityPair(router, tokenAddress);

    expect(project.creator).to.equal(creator.address);
    expect(project.receiver).to.equal(creator.address);
    expect(project.platformFeeReceiver).to.equal(owner.address);
    expect(project.templateId).to.equal(params.templateId);
    expect(project.rewardToken).to.equal(await factory.DEFAULT_REWARD_TOKEN());
    expect(project.buyTaxBps).to.equal(BigInt(params.buyTaxBps));
    expect(project.lpFeeBps).to.equal(BigInt(params.lpFeeBps));
    expect(project.whitelistMintCount).to.equal(0n);
    expect(project.publicMintCount).to.equal(params.mintCount);
    expect(await token.owner()).to.equal(creator.address);
    expect(await token.liquidityRouter()).to.equal(await router.getAddress());
    expect(await token.liquidityPair()).to.equal(launchPair);
    expect(await token.automatedMarketMakerPairs(launchPair)).to.equal(true);
    expect(await token.rewardToken()).to.equal(await factory.DEFAULT_REWARD_TOKEN());
    expect(await token.balanceOf(project.vault)).to.equal(params.totalSupply);
    expect(await vault.tokensForSale()).to.equal(params.totalSupply / 2n);
    expect(await vault.liquidityTokenReserve()).to.equal(params.totalSupply / 2n);
    expect(await factory.creatorTokensLength(creator.address)).to.equal(1n);
    expect(await factory.creatorTokenAt(creator.address, 0)).to.equal(tokenAddress);
    expect(await factory.templateTokensLength(params.templateId)).to.equal(1n);
    expect(await factory.templateTokenAt(params.templateId, 0)).to.equal(tokenAddress);

    const projectPage = await factory.getProjects(0n, 10n);
    expect(projectPage.length).to.equal(1);
    expect(projectPage[0].token).to.equal(tokenAddress);
  });

  it("rejects launch salts that do not create the required token suffix", async function () {
    const { owner, creator, creationFee, factory, tokenDeployer } = await deployFactory(0xaaaa);
    const params = launchParams(creator.address);
    let salt = ethers.id("wrong-suffix-1");

    for (let i = 1; i < 8; i += 1) {
      const predicted = await predictTokenAddress(
        await tokenDeployer.getAddress(),
        await factory.getAddress(),
        creator.address,
        owner.address,
        params,
        salt,
      );
      if (!predicted.toLowerCase().endsWith("aaaa")) {
        break;
      }
      salt = ethers.id(`wrong-suffix-${i + 1}`);
    }

    let rejected = false;
    try {
      await factory
        .connect(creator)
        .createLaunch(params, salt, { value: creationFee });
    } catch {
      rejected = true;
    }

    expect(rejected).to.equal(true);
    expect(await factory.allTokensLength()).to.equal(0n);
  });

  it("lets users mint real ERC20 balances from the vault", async function () {
    const { creator, buyer, creationFee, factory, router } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-2"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });
    const pairAddress = await getLiquidityPair(router, tokenAddress);

    expect(await vault.mintedCount()).to.equal(2n);
    expect(await token.balanceOf(buyer.address)).to.equal((await vault.tokensPerMint()) * 2n);
    expect(await ethers.provider.getBalance(project.vault)).to.equal(0n);
    expect(await ethers.provider.getBalance(pairAddress)).to.equal(params.mintPrice * 2n);
    expect(await vault.finalized()).to.equal(false);
  });

  it("rejects USDT mint launches while token/payment-token liquidity is disabled", async function () {
    const { creator, creationFee, factory } = await deployFactory();
    const usdt = await ethers.deployContract("MockRewardToken");
    const params = {
      ...launchParams(creator.address),
      mintCount: 3n,
      mintPrice: ethers.parseUnits("1", 18),
      paymentToken: await usdt.getAddress(),
      rewardToken: await usdt.getAddress(),
    };

    let blocked = false;
    try {
      await factory
        .connect(creator)
        .createLaunch(params, ethers.id("salt-usdt-disabled"), { value: creationFee });
    } catch {
      blocked = true;
    }
    expect(blocked).to.equal(true);
  });

  it("enforces the configured per-wallet mint limit", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 5n,
      maxMintPerWallet: 2n,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-wallet-limit"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });
    let limitBlocked = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      limitBlocked = true;
    }
    expect(limitBlocked).to.equal(true);
  });

  it("refunds buyers after 24 hours when the launch is not sold out", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-refund-window"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    const quantity = 2n;
    const cost = params.mintPrice * quantity;
    const tokenAmount = (await vault.tokensPerMint()) * quantity;

    await vault.connect(buyer).mint(quantity, { value: cost });

    let earlyRefundBlocked = false;
    try {
      await vault.connect(buyer).claimRefund();
    } catch {
      earlyRefundBlocked = true;
    }

    expect(earlyRefundBlocked).to.equal(true);

    await increaseTime(24 * 60 * 60 + 1);
    await token.connect(buyer).approve(project.vault, tokenAmount);
    await vault.connect(buyer).claimRefund();

    expect(await vault.paidByWallet(buyer.address)).to.equal(0n);
    expect(await vault.mintedByWallet(buyer.address)).to.equal(0n);
    expect(await vault.mintedCount()).to.equal(0n);
    expect(await vault.refundedCount()).to.equal(quantity);
    expect(await vault.refundedPayment()).to.equal(cost);
    expect(await token.balanceOf(buyer.address)).to.equal(0n);
    expect(await token.balanceOf(project.vault)).to.equal(params.totalSupply);
    expect(await ethers.provider.getBalance(project.vault)).to.equal(0n);
  });

  it("finalizes the launch, enables trading, adds Pancake liquidity, and burns LP when sold out", async function () {
    const { creator, buyer, dividendReceiver, creationFee, factory, router } = await deployFactory();
    const params = {
      ...launchParams(dividendReceiver.address),
      mintCount: 2n,
    };
    const cost = params.mintPrice * params.mintCount;

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-finalize"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    const receiverBefore = await ethers.provider.getBalance(dividendReceiver.address);

    expect(await token.tradingEnabled()).to.equal(false);
    await vault.connect(buyer).mint(params.mintCount, { value: cost });

    const pairAddress = await getLiquidityPair(router, tokenAddress);
    const pair = await ethers.getContractAt("MockPancakePair", pairAddress);

    expect(await vault.finalized()).to.equal(true);
    expect(await token.tradingEnabled()).to.equal(true);
    expect(await token.automatedMarketMakerPairs(pairAddress)).to.equal(true);
    expect(await token.owner()).to.equal(await token.LP_BLACK_HOLE());
    expect(await vault.owner()).to.equal(await vault.PERMISSION_BLACK_HOLE());
    expect(await ethers.provider.getBalance(project.vault)).to.equal(0n);
    expect((await ethers.provider.getBalance(dividendReceiver.address)) - receiverBefore).to.equal(0n);
    expect(await token.balanceOf(pairAddress)).to.equal(await vault.liquidityAddedToken());
    expect(await ethers.provider.getBalance(pairAddress)).to.equal(cost);
    expect(await pair.balanceOf(await vault.PERMISSION_BLACK_HOLE())).to.equal(cost);

    await increaseTime(24 * 60 * 60 + 1);

    let refundBlocked = false;
    try {
      await vault.connect(buyer).claimRefund();
    } catch {
      refundBlocked = true;
    }

    expect(refundBlocked).to.equal(true);
  });

  it("locks creator permissions to the black hole after trading opens", async function () {
    const { creator, buyer, pair, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      whitelistMintCount: 1n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-lock-permissions"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 1n);
    await token.connect(creator).setDividendReceiver(dividendReceiver.address);
    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await token.owner()).to.equal(await token.LP_BLACK_HOLE());
    expect(await vault.owner()).to.equal(await vault.PERMISSION_BLACK_HOLE());

    let taxBlocked = false;
    try {
      await token.connect(creator).setTaxes({
        buyTaxBps: 100,
        sellTaxBps: 100,
        transferTaxBps: 0,
        addLiquidityTaxBps: 0,
        removeLiquidityTaxBps: 0,
        launchProtectionTaxBps: 0,
        launchProtectionBlocks: 0,
        claimWait: 0,
        fundFeeBps: 10000,
        lpFeeBps: 0,
        dividendFeeBps: 0,
        burnFeeBps: 0,
      });
    } catch {
      taxBlocked = true;
    }
    expect(taxBlocked).to.equal(true);

    let receiverBlocked = false;
    try {
      await token.connect(creator).setReceiver(dividendReceiver.address);
    } catch {
      receiverBlocked = true;
    }
    expect(receiverBlocked).to.equal(true);

    let exemptBlocked = false;
    try {
      await token.connect(creator).setTaxExempt(buyer.address, true);
    } catch {
      exemptBlocked = true;
    }
    expect(exemptBlocked).to.equal(true);

    let pairBlocked = false;
    try {
      await token.connect(creator).setAutomatedMarketMakerPair(dividendReceiver.address, true);
    } catch {
      pairBlocked = true;
    }
    expect(pairBlocked).to.equal(true);

    let whitelistBlocked = false;
    try {
      await vault.connect(creator).setWhitelistAllowance(dividendReceiver.address, 1n);
    } catch {
      whitelistBlocked = true;
    }
    expect(whitelistBlocked).to.equal(true);

    let vaultReceiverBlocked = false;
    try {
      await vault.connect(creator).setReceiver(dividendReceiver.address);
    } catch {
      vaultReceiverBlocked = true;
    }
    expect(vaultReceiverBlocked).to.equal(true);
  });

  it("locks normal transfers before sellout and unlocks them automatically after sellout", async function () {
    const { creator, buyer, pair, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-trading-lock"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    const tokensPerMint = await vault.tokensPerMint();

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await vault.connect(buyer).mint(1n, { value: params.mintPrice });

    let locked = false;
    try {
      await token.connect(buyer).transfer(pair.address, tokensPerMint / 10n);
    } catch {
      locked = true;
    }

    expect(locked).to.equal(true);

    await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    await token.connect(buyer).transfer(pair.address, tokensPerMint / 10n);

    expect((await token.balanceOf(pair.address)) > 0n).to.equal(true);
  });

  it("rejects launch creation without the minimum deployment fee", async function () {
    const { creator, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    let rejected = false;
    try {
      await factory
        .connect(creator)
        .createLaunch(params, ethers.id("salt-3"), { value: creationFee - 1n });
    } catch {
      rejected = true;
    }

    expect(rejected).to.equal(true);
  });

  it("rejects zero-price launches so BNB launches cannot finalize without payment liquidity", async function () {
    const { creator, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintPrice: 0n,
    };

    let rejected = false;
    try {
      await factory
        .connect(creator)
        .createLaunch(params, ethers.id("salt-zero-price"), { value: creationFee });
    } catch {
      rejected = true;
    }

    expect(rejected).to.equal(true);
  });

  it("refunds deployment fee overpayment to the creator", async function () {
    const { owner, creator, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);
    const feeRecipientBefore = await ethers.provider.getBalance(owner.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-refund"), {
        value: creationFee + ethers.parseEther("0.5"),
      });

    const feeRecipientAfter = await ethers.provider.getBalance(owner.address);
    expect(feeRecipientAfter - feeRecipientBefore).to.equal(creationFee);
  });

  it("enforces whitelist minting when whitelist mode is enabled", async function () {
    const { creator, buyer, pair, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      whitelistMintCount: 2n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-whitelist"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    let blocked = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      blocked = true;
    }

    expect(blocked).to.equal(true);

    let nonOwnerBlocked = false;
    try {
      await vault.connect(buyer).setWhitelistAllowance(buyer.address, 2n);
    } catch {
      nonOwnerBlocked = true;
    }

    expect(nonOwnerBlocked).to.equal(true);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 2n);
    expect(await vault.whitelistList(buyer.address)).to.equal(true);
    expect(await vault.whitelistAccountCount()).to.equal(1n);

    await vault.connect(creator).setWhitelistAllowance(dividendReceiver.address, 1n);
    expect(await vault.whitelistAccountCount()).to.equal(2n);

    await vault.connect(creator).setWhitelistAllowance(pair.address, 1n);
    expect(await vault.whitelistAccountCount()).to.equal(3n);

    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await vault.whitelistRemaining(buyer.address)).to.equal(0n);
    expect(await token.balanceOf(buyer.address)).to.equal((await vault.tokensPerMint()) * 2n);

    let overLimit = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      overLimit = true;
    }

    expect(overLimit).to.equal(true);
  });

  it("allows more whitelist addresses than reserved whitelist mint slots", async function () {
    const { creator, buyer, pair, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 3n,
      whitelistMintCount: 1n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-whitelist-overbook"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(creator).setWhitelistAccounts(
      [buyer.address, pair.address, dividendReceiver.address],
      true,
    );

    expect(await vault.whitelistAccountCount()).to.equal(3n);
    expect(await vault.totalWhitelistAllowance()).to.equal(3n);
    await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    expect(await vault.whitelistMintedCount()).to.equal(1n);

    await vault.connect(pair).mint(2n, { value: params.mintPrice * 2n });
    expect(await vault.publicMintedCount()).to.equal(2n);
    expect(await vault.mintedCount()).to.equal(3n);
  });

  it("releases unused whitelist slots to public minting when whitelist mode is disabled", async function () {
    const { creator, buyer, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 5n,
      whitelistMintCount: 3n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-whitelist-disable"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 1n);
    await vault.connect(buyer).mint(1n, { value: params.mintPrice });

    let publicBlocked = false;
    try {
      await vault.connect(dividendReceiver).mint(1n, { value: params.mintPrice });
    } catch {
      publicBlocked = true;
    }
    expect(publicBlocked).to.equal(true);

    await vault.connect(creator).setWhitelistEnabled(false);
    await vault.connect(dividendReceiver).mint(4n, { value: params.mintPrice * 4n });

    expect(await vault.whitelistMintedCount()).to.equal(1n);
    expect(await vault.publicMintedCount()).to.equal(4n);
    expect(await vault.mintedCount()).to.equal(5n);
    expect(await vault.finalized()).to.equal(true);
  });

  it("separates public mint quota from whitelist mint quota", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 5n,
      whitelistMintCount: 2n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-quota"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    expect(await vault.whitelistMintLimit()).to.equal(2n);
    expect(await vault.publicMintLimit()).to.equal(3n);
    expect(await vault.owner()).to.equal(creator.address);

    let publicBeforeWhitelistBlocked = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      publicBeforeWhitelistBlocked = true;
    }

    expect(publicBeforeWhitelistBlocked).to.equal(true);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 2n);
    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await vault.whitelistMintedCount()).to.equal(2n);
    expect(await vault.publicMintedCount()).to.equal(0n);

    await vault.connect(buyer).mint(3n, { value: params.mintPrice * 3n });
    expect(await vault.publicMintedCount()).to.equal(3n);
    expect(await vault.mintedCount()).to.equal(5n);
  });

  it("rejects direct BNB transfers to the vault outside mint", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-direct-transfer"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);

    let directTransferBlocked = false;
    try {
      await buyer.sendTransaction({
        to: project.vault,
        value: params.mintPrice,
      });
    } catch {
      directTransferBlocked = true;
    }

    expect(directTransferBlocked).to.equal(true);
  });

  it("routes sell tax through swapback to platform, marketing, USDT dividends, LP black hole, and burn", async function () {
    const { owner, creator, buyer, creationFee, factory, router } = await deployFactory();
    const rewardToken = await ethers.deployContract("MockRewardToken");
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      rewardToken: await rewardToken.getAddress(),
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-tax"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await owner.sendTransaction({
      to: await router.getAddress(),
      value: ethers.parseEther("100"),
    });
    await token.connect(creator).setSwapSettings(true, 1n);
    await token.connect(creator).setDistributorGas(0n);
    await vault.connect(buyer).mint(params.mintCount, { value: params.mintPrice * params.mintCount });

    const pairAddress = await getLiquidityPair(router, tokenAddress);
    const pair = await ethers.getContractAt("MockPancakePair", pairAddress);
    const transferAmount = ethers.parseUnits("1", 18);
    const fee = (transferAmount * BigInt(params.sellTaxBps)) / 10000n;
    const platformAmount = (fee * BigInt(await token.PLATFORM_TAX_SHARE_BPS())) / 10000n;
    const projectFee = fee - platformAmount;
    const lpAmount = (projectFee * BigInt(params.lpFeeBps)) / 10000n;
    const dividendAmount = (projectFee * BigInt(params.dividendFeeBps)) / 10000n;
    const burnAmount = (projectFee * BigInt(params.burnFeeBps)) / 10000n;
    const marketingAmount = projectFee - lpAmount - dividendAmount - burnAmount;
    const liquidityHalf = lpAmount / 2n;
    const liquiditySwapTokens = lpAmount - liquidityHalf;
    const supplyBefore = await token.totalSupply();
    const blackHole = await token.LP_BLACK_HOLE();
    const burnSinkBefore = await token.balanceOf(blackHole);
    const platformBefore = await ethers.provider.getBalance(owner.address);
    const marketingBefore = await ethers.provider.getBalance(creator.address);
    const lpBefore = await pair.balanceOf(blackHole);
    const pairTokenBefore = await token.balanceOf(pairAddress);

    await token.connect(buyer).approve(await router.getAddress(), transferAmount);
    await router.connect(buyer).swapExactTokensForETHSupportingFeeOnTransferTokens(
      transferAmount,
      0,
      [tokenAddress, await router.WETH()],
      buyer.address,
      0,
    );

    const distributorAddress = await token.dividendDistributor();
    const buyerUnpaid = await token.unpaidDividend(buyer.address);
    const buyerRewardBalance = await rewardToken.balanceOf(buyer.address);
    const distributorRewardBalance = await rewardToken.balanceOf(distributorAddress);

    expect((await token.balanceOf(pairAddress)) - pairTokenBefore).to.equal(
      transferAmount - burnAmount,
    );
    expect((await ethers.provider.getBalance(owner.address)) - platformBefore).to.equal(platformAmount);
    expect((await ethers.provider.getBalance(creator.address)) - marketingBefore).to.equal(marketingAmount);
    expect((await pair.balanceOf(blackHole)) - lpBefore).to.equal(liquiditySwapTokens);
    expect(buyerRewardBalance + distributorRewardBalance).to.equal(dividendAmount);
    expect(buyerRewardBalance + buyerUnpaid).to.equal(dividendAmount);
    expect((await token.balanceOf(blackHole)) - burnSinkBefore).to.equal(burnAmount);
    expect(await token.totalSupply()).to.equal(supplyBefore);
    expect(await token.totalPlatformRouted()).to.equal(platformAmount);
    expect(await token.totalMarketingRouted()).to.equal(marketingAmount);
    expect(await token.totalLiquidityAdded()).to.equal(liquiditySwapTokens);
    expect(await token.totalDividendsDeposited()).to.equal(dividendAmount);
    expect(await token.totalTaxBurned()).to.equal(burnAmount);

    if (buyerUnpaid > 0n) {
      await token.connect(buyer).claimDividend();
      expect(await rewardToken.balanceOf(buyer.address)).to.equal(dividendAmount);
    }
  });

  it("does not block sells when swapback reward routing fails", async function () {
    const { owner, creator, buyer, dividendReceiver, creationFee, factory, router } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      rewardToken: dividendReceiver.address,
      fundFeeBps: 0,
      lpFeeBps: 0,
      dividendFeeBps: 10000,
      burnFeeBps: 0,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-swapback-fail-open"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await owner.sendTransaction({
      to: await router.getAddress(),
      value: ethers.parseEther("100"),
    });
    await token.connect(creator).setSwapSettings(true, 1n);
    await token.connect(creator).setDistributorGas(0n);
    await vault.connect(buyer).mint(params.mintCount, { value: params.mintPrice * params.mintCount });

    const pairAddress = await getLiquidityPair(router, tokenAddress);
    const transferAmount = ethers.parseUnits("1", 18);
    const fee = (transferAmount * BigInt(params.sellTaxBps)) / 10000n;
    const pairTokenBefore = await token.balanceOf(pairAddress);

    await token.connect(buyer).approve(await router.getAddress(), transferAmount);
    await router.connect(buyer).swapExactTokensForETHSupportingFeeOnTransferTokens(
      transferAmount,
      0,
      [tokenAddress, await router.WETH()],
      buyer.address,
      0,
    );

    expect((await token.balanceOf(pairAddress)) - pairTokenBefore).to.equal(transferAmount - fee);
    expect(await token.balanceOf(await token.getAddress())).to.equal(fee);
    expect((await token.tokensForPlatform()) + (await token.tokensForDividends())).to.equal(fee);
  });

  it("lets BscScan-style token mint buttons forward the real minter to the vault", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 4n,
      whitelistMintCount: 2n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-token-mint"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 2n);
    await token.connect(buyer).mintToken(2n, { value: params.mintPrice * 2n });

    expect(await vault.mintedByWallet(buyer.address)).to.equal(2n);
    expect(await vault.whitelistMintedByWallet(buyer.address)).to.equal(2n);
    expect(await token.balanceOf(buyer.address)).to.equal((await vault.tokensPerMint()) * 2n);
  });

  it("lets direct BNB transfers to the token mint whitelist and public slots", async function () {
    const { creator, buyer, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 3n,
      whitelistMintCount: 1n,
      whitelistEnabled: true,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-direct-token-mint"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);
    const tokensPerMint = await vault.tokensPerMint();

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 1n);
    await buyer.sendTransaction({
      to: tokenAddress,
      value: params.mintPrice,
    });

    expect(await vault.whitelistMintedCount()).to.equal(1n);
    expect(await token.balanceOf(buyer.address)).to.equal(tokensPerMint);

    await dividendReceiver.sendTransaction({
      to: tokenAddress,
      value: params.mintPrice * 2n,
      data: "0x12345678",
    });

    expect(await vault.publicMintedCount()).to.equal(2n);
    expect(await vault.mintedCount()).to.equal(3n);
    expect(await token.balanceOf(dividendReceiver.address)).to.equal(
      (await vault.tokensForSale()) - tokensPerMint,
    );
  });

  it("charges wallet transfer tax separately from buy and sell tax", async function () {
    const { creator, buyer, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      buyTaxBps: 0,
      sellTaxBps: 0,
      transferTaxBps: 200,
      fundFeeBps: 10000,
      lpFeeBps: 0,
      dividendFeeBps: 0,
      burnFeeBps: 0,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-transfer-tax"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(buyer).mint(params.mintCount, { value: params.mintPrice * params.mintCount });

    const amount = ethers.parseUnits("1000", 18);
    const fee = (amount * BigInt(params.transferTaxBps)) / 10000n;
    await token.connect(buyer).transfer(dividendReceiver.address, amount);

    expect(await token.balanceOf(dividendReceiver.address)).to.equal(amount - fee);
    expect(await token.balanceOf(await token.getAddress())).to.equal(fee);
    expect(await token.tokensForPlatform()).to.equal((fee * BigInt(await token.PLATFORM_TAX_SHARE_BPS())) / 10000n);
  });

  it("enforces dividend claim wait after the first claim", async function () {
    const { owner, buyer } = await deployFactory();
    const rewardToken = await ethers.deployContract("MockRewardToken");
    const distributor = await ethers.deployContract("AppleDividendDistributor", [
      await rewardToken.getAddress(),
      60,
    ]);

    const firstDividend = ethers.parseUnits("10", 18);
    await rewardToken.mint(await distributor.getAddress(), firstDividend);
    await distributor.connect(owner).setShare(buyer.address, ethers.parseUnits("100", 18));
    await distributor.connect(owner).deposit(firstDividend);
    expect(firstDividend > 0n).to.equal(true);
    await distributor.connect(buyer).claimDividend();

    const secondDividend = ethers.parseUnits("5", 18);
    await rewardToken.mint(await distributor.getAddress(), secondDividend);
    await distributor.connect(owner).deposit(secondDividend);
    expect((await distributor.getUnpaidEarnings(buyer.address)) > 0n).to.equal(true);

    let claimBlocked = false;
    try {
      await distributor.connect(buyer).claimDividend();
    } catch {
      claimBlocked = true;
    }
    expect(claimBlocked).to.equal(true);

    await increaseTime(61);
    await distributor.connect(buyer).claimDividend();
    expect((await rewardToken.balanceOf(buyer.address)) > firstDividend).to.equal(true);
  });

  it("detects add-liquidity transfers and applies the configured LP add tax", async function () {
    const { creator, buyer, creationFee, factory, router } = await deployFactory();
    const params = {
      ...launchParams(creator.address),
      mintCount: 2n,
      buyTaxBps: 0,
      sellTaxBps: 0,
      addLiquidityTaxBps: 500,
      fundFeeBps: 10000,
      lpFeeBps: 0,
      dividendFeeBps: 0,
      burnFeeBps: 0,
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-add-lp-tax"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await token.connect(creator).setSwapSettings(false, 1n);
    await vault.connect(buyer).mint(params.mintCount, { value: params.mintPrice * params.mintCount });

    const addAmount = ethers.parseUnits("1000", 18);
    const fee = (addAmount * BigInt(params.addLiquidityTaxBps)) / 10000n;
    await token.connect(buyer).approve(await router.getAddress(), addAmount);
    await router.connect(buyer).addLiquidityETH(
      tokenAddress,
      addAmount,
      0,
      0,
      buyer.address,
      0,
      { value: ethers.parseEther("0.1") },
    );

    const pairAddress = await getLiquidityPair(router, tokenAddress);
    expect(await token.balanceOf(pairAddress)).to.equal((await vault.liquidityAddedToken()) + addAmount - fee);
    expect(await token.balanceOf(await token.getAddress())).to.equal(fee);
  });

  it("keeps dividend rewards pending until an eligible holder reaches the threshold", async function () {
    const { owner, creator, creationFee, factory, router } = await deployFactory();
    const [, , buyerA, buyerB, buyerC, buyerD] = await ethers.getSigners();
    const rewardToken = await ethers.deployContract("MockRewardToken");
    const params = {
      ...launchParams(creator.address),
      mintCount: 4n,
      rewardToken: await rewardToken.getAddress(),
      rewardThreshold: ethers.parseUnits("150000", 18),
    };

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-pending-dividends"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await owner.sendTransaction({
      to: await router.getAddress(),
      value: ethers.parseEther("100"),
    });
    await token.connect(creator).setSwapSettings(true, 1n);
    await token.connect(creator).setDistributorGas(0n);

    await vault.connect(buyerA).mint(1n, { value: params.mintPrice });
    await vault.connect(buyerB).mint(1n, { value: params.mintPrice });
    await vault.connect(buyerC).mint(1n, { value: params.mintPrice });
    await vault.connect(buyerD).mint(1n, { value: params.mintPrice });

    const distributorAddress = await token.dividendDistributor();
    const distributor = await ethers.getContractAt("AppleDividendDistributor", distributorAddress);
    expect(await distributor.totalShares()).to.equal(0n);

    const pairAddress = await getLiquidityPair(router, tokenAddress);
    await token.connect(buyerA).transfer(pairAddress, ethers.parseUnits("1000", 18));

    const pendingDividends = await distributor.pendingDividends();
    expect(pendingDividends > 0n).to.equal(true);
    expect(await token.unpaidDividend(buyerA.address)).to.equal(0n);

    await token.connect(buyerB).transfer(buyerA.address, ethers.parseUnits("30000", 18));

    expect(await distributor.pendingDividends()).to.equal(0n);
    const unpaidDividend = await token.unpaidDividend(buyerA.address);
    expect(unpaidDividend > 0n).to.equal(true);

    await token.connect(buyerA).claimDividend();
    expect(await rewardToken.balanceOf(buyerA.address)).to.equal(unpaidDividend);
  });
});
