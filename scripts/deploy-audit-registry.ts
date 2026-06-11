import { network } from "hardhat";

const { ethers } = await network.connect();

console.log("Deploying AppleAuditRegistry");

const registry = await ethers.deployContract("AppleAuditRegistry");
await registry.waitForDeployment();

console.log("Audit Registry:", await registry.getAddress());
