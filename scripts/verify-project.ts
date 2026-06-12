import "dotenv/config";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, isAddress } from "ethers";

const factoryArtifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json", "utf8"),
);
const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
] as const;

const factoryAddress =
  process.env.FACTORY_ADDRESS ??
  readDeploymentFactory() ??
  process.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ??
  "";
const tokenAddress = readTokenAddress();
const provider = new JsonRpcProvider(process.env.BSC_RPC_URL ?? "https://bsc.publicnode.com", 56);
const factory = new Contract(factoryAddress, factoryArtifact.abi, provider);

if (!isAddress(factoryAddress)) {
  throw new Error("FACTORY_ADDRESS or VITE_LAUNCHPAD_FACTORY_ADDRESS is invalid.");
}
if (!isAddress(tokenAddress)) {
  throw new Error("Set PROJECT_TOKEN=0x... or pass the token address as the first argument.");
}

const project = await factory.getProject(tokenAddress);
if (String(project.token).toLowerCase() !== tokenAddress.toLowerCase()) {
  throw new Error(`Token ${tokenAddress} is not indexed in Factory ${factoryAddress}.`);
}
const liquidityRouter = await factory.liquidityRouter();

const token = new Contract(tokenAddress, tokenAbi, provider);
const [name, symbol] = await Promise.all([token.name(), token.symbol()]);
const tokenConstructorArgs = [
  [
    name,
    symbol,
    project.metadataUri,
    project.templateId,
    project.receiver,
    project.platformFeeReceiver,
    project.paymentToken,
    project.rewardToken,
    project.rewardThreshold,
    project.totalSupply,
  ],
  [
    project.buyTaxBps,
    project.sellTaxBps,
    project.transferTaxBps,
    project.addLiquidityTaxBps,
    project.removeLiquidityTaxBps,
    project.launchProtectionTaxBps,
    project.launchProtectionBlocks,
    project.claimWait,
    project.fundFeeBps,
    project.lpFeeBps,
    project.dividendFeeBps,
    project.burnFeeBps,
  ],
  factoryAddress,
];
const vaultConstructorArgs = [
  tokenAddress,
  liquidityRouter,
  project.paymentToken,
  project.creator,
  project.receiver,
  project.totalSupply,
  project.mintCount,
  project.mintPrice,
  project.whitelistMintCount,
  project.whitelistEnabled,
];

console.log("Verifying project contracts");
console.log("Factory:", factoryAddress);
console.log("Token:", tokenAddress);
console.log("Vault:", project.vault);

const argsDir = path.join("work", "verify-args", tokenAddress.toLowerCase());
fs.mkdirSync(argsDir, { recursive: true });
const tokenArgsPath = path.join(argsDir, "token.cjs");
const vaultArgsPath = path.join(argsDir, "vault.cjs");
writeArgsFile(tokenArgsPath, tokenConstructorArgs);
writeArgsFile(vaultArgsPath, vaultConstructorArgs);

await verifyOne({
  address: tokenAddress,
  constructorArgsPath: tokenArgsPath,
  contract: "contracts/AppleToken.sol:AppleToken",
  label: "Token",
});
await verifyOne({
  address: project.vault,
  constructorArgsPath: vaultArgsPath,
  contract: "contracts/AppleMintVault.sol:AppleMintVault",
  label: "Vault",
});

function readTokenAddress() {
  const cliValue = process.argv.find((arg) => isAddress(arg));
  return process.env.PROJECT_TOKEN ?? cliValue ?? "";
}

function readDeploymentFactory() {
  try {
    const deployment = JSON.parse(fs.readFileSync("deployments/bsc.json", "utf8"));
    const address = String(deployment.factory ?? "");
    return isAddress(address) ? address : undefined;
  } catch {
    return undefined;
  }
}

async function verifyOne({
  address,
  constructorArgsPath,
  contract,
  label,
}: {
  address: string;
  constructorArgsPath: string;
  contract: string;
  label: string;
}) {
  console.log(`Verifying ${label}: ${address}`);
  await runCommand("npx", [
    "hardhat",
    "verify",
    "--network",
    "bsc",
    "--contract",
    contract,
    "--constructor-args-path",
    constructorArgsPath,
    address,
  ]);
}

function writeArgsFile(filePath: string, args: unknown[]) {
  const normalized = JSON.stringify(args, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  fs.writeFileSync(filePath, `module.exports = ${normalized};\n`);
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
