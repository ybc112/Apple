import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("AppleLaunchFactory", function () {
  async function deployFactory() {
    const [owner, creator, buyer, pair, dividendReceiver] = await ethers.getSigners();
    const creationFee = ethers.parseEther("0.005");
    const factory = await ethers.deployContract("AppleLaunchFactory", [
      owner.address,
      creationFee,
    ]);

    return { owner, creator, buyer, pair, dividendReceiver, creationFee, factory };
  }

  function launchParams(receiver: string) {
    return {
      name: "Apple Seed",
      symbol: "APPLE",
      metadataUri: "ipfs://apple-seed",
      totalSupply: ethers.parseUnits("1000000", 18),
      mintCount: 1000n,
      mintPrice: ethers.parseEther("0.001"),
      paymentToken: ethersLib.ZeroAddress,
      rewardToken: ethersLib.ZeroAddress,
      rewardThreshold: 0n,
      receiver,
      templateId: ethers.id("standard"),
      buyTaxBps: 300,
      sellTaxBps: 300,
      fundFeeBps: 4400,
      lpFeeBps: 1800,
      dividendFeeBps: 1600,
      burnFeeBps: 1000,
      whitelistMintCount: 0n,
      whitelistEnabled: false,
    };
  }

  it("creates an independent token and mint vault after paying the launch fee", async function () {
    const { creator, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-1"), { value: creationFee });

    expect(await factory.allTokensLength()).to.equal(1n);

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);

    expect(project.creator).to.equal(creator.address);
    expect(project.receiver).to.equal(creator.address);
    expect(project.templateId).to.equal(params.templateId);
    expect(project.rewardToken).to.equal(await factory.DEFAULT_REWARD_TOKEN());
    expect(project.buyTaxBps).to.equal(BigInt(params.buyTaxBps));
    expect(project.lpFeeBps).to.equal(BigInt(params.lpFeeBps));
    expect(project.whitelistMintCount).to.equal(0n);
    expect(project.publicMintCount).to.equal(params.mintCount);
    expect(await token.owner()).to.equal(creator.address);
    expect(await token.rewardToken()).to.equal(await factory.DEFAULT_REWARD_TOKEN());
    expect(await token.balanceOf(project.vault)).to.equal(params.totalSupply);
    expect(await factory.creatorTokensLength(creator.address)).to.equal(1n);
    expect(await factory.creatorTokenAt(creator.address, 0)).to.equal(tokenAddress);
    expect(await factory.templateTokensLength(params.templateId)).to.equal(1n);
    expect(await factory.templateTokenAt(params.templateId, 0)).to.equal(tokenAddress);

    const projectPage = await factory.getProjects(0n, 10n);
    expect(projectPage.length).to.equal(1);
    expect(projectPage[0].token).to.equal(tokenAddress);
  });

  it("lets users mint real ERC20 balances from the vault", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-2"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await vault.mintedCount()).to.equal(2n);
    expect(await token.balanceOf(buyer.address)).to.equal((params.totalSupply / params.mintCount) * 2n);
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
    const { creator, buyer, creationFee, factory } = await deployFactory();
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
    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await vault.whitelistRemaining(buyer.address)).to.equal(0n);
    expect(await token.balanceOf(buyer.address)).to.equal((params.totalSupply / params.mintCount) * 2n);

    let overLimit = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      overLimit = true;
    }

    expect(overLimit).to.equal(true);
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

    await vault.connect(buyer).mint(3n, { value: params.mintPrice * 3n });
    expect(await vault.publicMintedCount()).to.equal(3n);

    let publicSoldOut = false;
    try {
      await vault.connect(buyer).mint(1n, { value: params.mintPrice });
    } catch {
      publicSoldOut = true;
    }

    expect(publicSoldOut).to.equal(true);

    await vault.connect(creator).setWhitelistAllowance(buyer.address, 2n);
    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });

    expect(await vault.whitelistMintedCount()).to.equal(2n);
    expect(await vault.mintedCount()).to.equal(5n);
  });

  it("routes sell tax to marketing, dividend, LP black hole, and burn", async function () {
    const { creator, buyer, pair, dividendReceiver, creationFee, factory } = await deployFactory();
    const params = launchParams(creator.address);

    await factory
      .connect(creator)
      .createLaunch(params, ethers.id("salt-tax"), { value: creationFee });

    const tokenAddress = await factory.allTokens(0);
    const project = await factory.projects(tokenAddress);
    const token = await ethers.getContractAt("AppleToken", tokenAddress);
    const vault = await ethers.getContractAt("AppleMintVault", project.vault);

    await vault.connect(buyer).mint(2n, { value: params.mintPrice * 2n });
    await token.connect(creator).setDividendReceiver(dividendReceiver.address);
    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);

    const transferAmount = ethers.parseUnits("1000", 18);
    const fee = (transferAmount * BigInt(params.sellTaxBps)) / 10000n;
    const lpAmount = (fee * BigInt(params.lpFeeBps)) / 10000n;
    const dividendAmount = (fee * BigInt(params.dividendFeeBps)) / 10000n;
    const burnAmount = (fee * BigInt(params.burnFeeBps)) / 10000n;
    const marketingAmount = fee - lpAmount - dividendAmount - burnAmount;
    const supplyBefore = await token.totalSupply();
    const blackHole = await token.LP_BLACK_HOLE();

    await token.connect(buyer).transfer(pair.address, transferAmount);

    expect(await token.balanceOf(pair.address)).to.equal(transferAmount - fee);
    expect(await token.balanceOf(blackHole)).to.equal(lpAmount);
    expect(await token.balanceOf(dividendReceiver.address)).to.equal(dividendAmount);
    expect(await token.balanceOf(creator.address)).to.equal(marketingAmount);
    expect(await token.totalSupply()).to.equal(supplyBefore - burnAmount);
  });
});
