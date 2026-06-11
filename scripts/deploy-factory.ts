import "dotenv/config";

import fs from "node:fs";
import { ContractFactory, JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";

const requiredEnv = ["BSC_RPC_URL", "PRIVATE_KEY"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnv.join(", ")}`);
}

const provider = new JsonRpcProvider(process.env.BSC_RPC_URL, 56);
const deployer = new Wallet(process.env.PRIVATE_KEY!, provider);
const artifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json", "utf8"),
);

const defaultFeeRecipient = "0x0D70FABE5B212f5BE5EFa503a2Dcc4D5C54B6347";
const feeRecipient = process.env.FEE_RECIPIENT ?? defaultFeeRecipient;
const creationFee = parseEther(process.env.CREATION_FEE_BNB ?? "0.005");
const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);

console.log("Deploying AppleLaunchFactory");
console.log("Deployer:", deployer.address);
console.log("Fee recipient:", feeRecipient);
console.log("Creation fee:", formatEther(creationFee), "BNB");

const contract = await factory.deploy(feeRecipient, creationFee);
const transaction = contract.deploymentTransaction();
console.log("Deployment tx:", transaction?.hash);

await contract.waitForDeployment();
const receipt = transaction ? await provider.getTransactionReceipt(transaction.hash) : null;

console.log("Factory:", await contract.getAddress());
console.log("Block:", receipt?.blockNumber ?? "pending");
