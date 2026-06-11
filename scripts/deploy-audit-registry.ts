import "dotenv/config";

import fs from "node:fs";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const requiredEnv = ["BSC_RPC_URL", "PRIVATE_KEY"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnv.join(", ")}`);
}

const provider = new JsonRpcProvider(process.env.BSC_RPC_URL, 56);
const deployer = new Wallet(process.env.PRIVATE_KEY!, provider);
const artifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleAuditRegistry.sol/AppleAuditRegistry.json", "utf8"),
);
const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);

console.log("Deploying AppleAuditRegistry");
console.log("Deployer:", deployer.address);

const contract = await factory.deploy();
const transaction = contract.deploymentTransaction();
console.log("Deployment tx:", transaction?.hash);

await contract.waitForDeployment();
const receipt = transaction ? await provider.getTransactionReceipt(transaction.hash) : null;

console.log("Audit Registry:", await contract.getAddress());
console.log("Block:", receipt?.blockNumber ?? "pending");
