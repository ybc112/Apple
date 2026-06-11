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
const factoryArtifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json", "utf8"),
);
const tokenDeployerArtifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleLaunchDeployers.sol/AppleTokenDeployer.json", "utf8"),
);
const vaultDeployerArtifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleLaunchDeployers.sol/AppleMintVaultDeployer.json", "utf8"),
);

const feeRecipient = process.env.FEE_RECIPIENT ?? deployer.address;
const liquidityRouter =
  process.env.PANCAKE_V2_ROUTER_ADDRESS ?? "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const creationFee = parseEther(process.env.CREATION_FEE_BNB ?? "0.005");
const factoryFactory = new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, deployer);
const tokenDeployerFactory = new ContractFactory(
  tokenDeployerArtifact.abi,
  tokenDeployerArtifact.bytecode,
  deployer,
);
const vaultDeployerFactory = new ContractFactory(
  vaultDeployerArtifact.abi,
  vaultDeployerArtifact.bytecode,
  deployer,
);

console.log("Deploying AppleLaunchFactory");
console.log("Deployer:", deployer.address);
console.log("Fee recipient: configured");
console.log("Liquidity router:", liquidityRouter);
console.log("Creation fee:", formatEther(creationFee), "BNB");

const tokenDeployer = await tokenDeployerFactory.deploy();
await tokenDeployer.waitForDeployment();
console.log("Token deployer:", await tokenDeployer.getAddress());

const vaultDeployer = await vaultDeployerFactory.deploy();
await vaultDeployer.waitForDeployment();
console.log("Vault deployer:", await vaultDeployer.getAddress());

const contract = await factoryFactory.deploy(
  feeRecipient,
  creationFee,
  liquidityRouter,
  await tokenDeployer.getAddress(),
  await vaultDeployer.getAddress(),
);
const transaction = contract.deploymentTransaction();
console.log("Deployment tx:", transaction?.hash);

await contract.waitForDeployment();
const receipt = transaction ? await provider.getTransactionReceipt(transaction.hash) : null;
const factoryAddress = await contract.getAddress();

console.log("Binding deployers to Factory");
await (await tokenDeployer.setFactory(factoryAddress)).wait();
await (await vaultDeployer.setFactory(factoryAddress)).wait();

console.log("Factory:", factoryAddress);
console.log("Block:", receipt?.blockNumber ?? "pending");
