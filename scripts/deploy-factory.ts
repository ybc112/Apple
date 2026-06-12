import "dotenv/config";

import fs from "node:fs";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, isAddress, parseEther } from "ethers";

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
const requiredTokenSuffix = parseTokenSuffix(
  process.env.REQUIRED_TOKEN_SUFFIX ?? process.env.VITE_VANITY_SUFFIX ?? "aaaa",
);
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
console.log("Required token suffix:", `0x${requiredTokenSuffix.toString(16).padStart(4, "0")}`);

let tokenDeployer: Contract;
let tokenDeployerTxHash: string | null = null;
const resumedTokenDeployer = process.env.RESUME_TOKEN_DEPLOYER ?? "";
if (resumedTokenDeployer) {
  if (!isAddress(resumedTokenDeployer)) {
    throw new Error("RESUME_TOKEN_DEPLOYER is invalid.");
  }
  tokenDeployer = new Contract(resumedTokenDeployer, tokenDeployerArtifact.abi, deployer);
  console.log("Token deployer (resumed):", resumedTokenDeployer);
} else {
  const deployedTokenDeployer = await tokenDeployerFactory.deploy();
  await deployedTokenDeployer.waitForDeployment();
  tokenDeployer = deployedTokenDeployer;
  tokenDeployerTxHash = deployedTokenDeployer.deploymentTransaction()?.hash ?? null;
  console.log("Token deployer:", await tokenDeployer.getAddress());
}

let vaultDeployer: Contract;
let vaultDeployerTxHash: string | null = null;
const resumedVaultDeployer = process.env.RESUME_VAULT_DEPLOYER ?? "";
if (resumedVaultDeployer) {
  if (!isAddress(resumedVaultDeployer)) {
    throw new Error("RESUME_VAULT_DEPLOYER is invalid.");
  }
  vaultDeployer = new Contract(resumedVaultDeployer, vaultDeployerArtifact.abi, deployer);
  console.log("Vault deployer (resumed):", resumedVaultDeployer);
} else {
  const deployedVaultDeployer = await vaultDeployerFactory.deploy();
  await deployedVaultDeployer.waitForDeployment();
  vaultDeployer = deployedVaultDeployer;
  vaultDeployerTxHash = deployedVaultDeployer.deploymentTransaction()?.hash ?? null;
  console.log("Vault deployer:", await vaultDeployer.getAddress());
}

const contract = await factoryFactory.deploy(
  feeRecipient,
  creationFee,
  liquidityRouter,
  await tokenDeployer.getAddress(),
  await vaultDeployer.getAddress(),
  requiredTokenSuffix,
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

const previousDeployment = readPreviousDeployment();
const deployment = {
  ...previousDeployment,
  network: "bsc",
  chainId: 56,
  factory: factoryAddress,
  tokenDeployer: await tokenDeployer.getAddress(),
  vaultDeployer: await vaultDeployer.getAddress(),
  liquidityRouter,
  creationFeeWei: creationFee.toString(),
  creationFeeBnb: formatEther(creationFee),
  requiredTokenSuffix: `0x${requiredTokenSuffix.toString(16).padStart(4, "0")}`,
  deploymentTx: transaction?.hash ?? null,
  tokenDeployerDeploymentTx: tokenDeployerTxHash,
  vaultDeployerDeploymentTx: vaultDeployerTxHash,
  blockNumber: receipt?.blockNumber ?? null,
  factoryBscScan: `https://bscscan.com/address/${factoryAddress}#code`,
  tokenDeployerBscScan: `https://bscscan.com/address/${await tokenDeployer.getAddress()}#code`,
  vaultDeployerBscScan: `https://bscscan.com/address/${await vaultDeployer.getAddress()}#code`,
  previousFactory: previousDeployment.factory ?? null,
  previousDeploymentTx: previousDeployment.deploymentTx ?? null,
};

fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync("deployments/bsc.json", `${JSON.stringify(deployment, null, 2)}\n`);
console.log("Deployment file updated: deployments/bsc.json");

function parseTokenSuffix(value: string) {
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{1,4}$/.test(normalized)) {
    throw new Error("REQUIRED_TOKEN_SUFFIX must be 1-4 hex characters.");
  }

  return Number.parseInt(normalized, 16);
}

function readPreviousDeployment() {
  try {
    return JSON.parse(fs.readFileSync("deployments/bsc.json", "utf8"));
  } catch {
    return {};
  }
}
