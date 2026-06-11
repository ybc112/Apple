import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("AppleLaunchFactory", function () {
  async function deployFactory() {
    const [owner, creator, buyer] = await ethers.getSigners();
    const creationFee = ethers.parseEther("0.005");
    const factory = await ethers.deployContract("AppleLaunchFactory", [
      owner.address,
      creationFee,
    ]);

    return { owner, creator, buyer, creationFee, factory };
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
      fundFeeBps: 6000,
      lpFeeBps: 0,
      dividendFeeBps: 0,
      burnFeeBps: 4000,
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
    expect(await token.owner()).to.equal(creator.address);
    expect(await token.balanceOf(project.vault)).to.equal(params.totalSupply);
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

  it("rejects launch creation without the exact minimum deployment fee", async function () {
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

  it("enforces whitelist minting when whitelist mode is enabled", async function () {
    const { creator, buyer, creationFee, factory } = await deployFactory();
    const params = { ...launchParams(creator.address), whitelistEnabled: true };

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
});
