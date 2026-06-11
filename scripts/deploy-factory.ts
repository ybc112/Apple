import "dotenv/config";

import { network } from "hardhat";

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();

const defaultFeeRecipient = "0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347";
const feeRecipient = process.env.FEE_RECIPIENT ?? defaultFeeRecipient;
const creationFee = ethers.parseEther(process.env.CREATION_FEE_BNB ?? "0.005");

console.log("Deploying AppleLaunchFactory");
console.log("Deployer:", deployer.address);
console.log("Fee recipient:", feeRecipient);
console.log("Creation fee:", ethers.formatEther(creationFee), "BNB");

const factory = await ethers.deployContract("AppleLaunchFactory", [feeRecipient, creationFee]);
await factory.waitForDeployment();

console.log("Factory:", await factory.getAddress());
