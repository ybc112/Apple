import "dotenv/config";

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  getCreate2Address,
  hexlify,
  id,
  isAddress,
  keccak256,
  randomBytes,
  solidityPackedKeccak256,
} from "ethers";

const rootDir = process.cwd();
const deployment = readJson("deployments/bsc.json", {});
const factoryArtifact = readJson("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json");
const tokenArtifact = readJson("artifacts/contracts/AppleToken.sol/AppleToken.json");

const chainId = Number(process.env.APPLE_CHAIN_ID ?? deployment.chainId ?? 56);
const rpcUrl = process.env.BSC_RPC_URL ?? process.env.APPLE_RPC_URL ?? "https://bsc.publicnode.com";
const factoryAddress = getAddress(
  process.env.FACTORY_ADDRESS ?? process.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ?? deployment.factory,
);
const provider = new JsonRpcProvider(rpcUrl, chainId);
const factory = new Contract(factoryAddress, factoryArtifact.abi, provider);
const port = Number(process.env.APPLE_BACKEND_PORT ?? 8787);
const backendToken = process.env.APPLE_BACKEND_TOKEN ?? "";
const autoVerify = process.env.AUTO_VERIFY_PROJECTS !== "false";
const pollMs = Number(process.env.VERIFY_POLL_MS ?? 30000);
const backfillCount = Number(process.env.VERIFY_BACKFILL_COUNT ?? 12);
const jobs = new Map();
let lastTokenCount = 0;
let verifying = false;

const server = createServer(async (request, response) => {
  try {
    setCors(response);
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        chainId,
        factory: factoryAddress,
        autoVerify,
        queued: [...jobs.values()].filter((job) => job.status === "queued").length,
        running: [...jobs.values()].filter((job) => job.status === "running").length,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/verify-status") {
      const token = normalizeAddress(url.searchParams.get("token") ?? "");
      sendJson(response, 200, { token, job: jobs.get(token.toLowerCase()) ?? null });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/verify-project") {
      requireToken(request);
      const body = await readBody(request);
      const token = normalizeAddress(body.token);
      await assertFactoryProject(token);
      queueVerify(token, "api");
      sendJson(response, 202, { ok: true, token, job: jobs.get(token.toLowerCase()) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/vanity-salt") {
      requireToken(request);
      const body = await readBody(request);
      const result = await findVanitySalt(body);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`Apple backend listening on :${port}`);
  console.log(`Factory: ${factoryAddress}`);
  if (autoVerify) {
    void syncProjects(true);
    setInterval(() => void syncProjects(false), pollMs);
  }
});

async function syncProjects(backfill) {
  try {
    const count = Number(await factory.allTokensLength());
    const start = backfill ? Math.max(0, count - backfillCount) : lastTokenCount;
    for (let index = start; index < count; index += 1) {
      const token = getAddress(await factory.allTokens(index));
      queueVerify(token, backfill ? "backfill" : "monitor");
    }
    lastTokenCount = count;
  } catch (error) {
    console.error("Project sync failed:", error instanceof Error ? error.message : error);
  }
}

function queueVerify(token, source) {
  const key = token.toLowerCase();
  const current = jobs.get(key);
  if (current && ["queued", "running", "success"].includes(current.status)) {
    return;
  }

  jobs.set(key, {
    token,
    source,
    status: "queued",
    logs: [],
    updatedAt: new Date().toISOString(),
  });
  void drainVerifyQueue();
}

async function drainVerifyQueue() {
  if (verifying) {
    return;
  }
  verifying = true;

  try {
    while (true) {
      const job = [...jobs.values()].find((item) => item.status === "queued");
      if (!job) {
        return;
      }

      job.status = "running";
      job.updatedAt = new Date().toISOString();

      try {
        const logs = await runVerify(job.token);
        job.status = "success";
        job.logs = logs;
      } catch (error) {
        job.status = "error";
        job.logs = [error instanceof Error ? error.message : String(error)];
      }
      job.updatedAt = new Date().toISOString();
    }
  } finally {
    verifying = false;
  }
}

function runVerify(token) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn("npm", ["run", "contracts:verify:project"], {
      cwd: rootDir,
      env: { ...process.env, PROJECT_TOKEN: token, FACTORY_ADDRESS: factoryAddress, BSC_RPC_URL: rpcUrl },
      shell: process.platform === "win32",
    });

    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(logs.slice(-80));
        return;
      }

      reject(new Error(logs.join("") || `verify exited with code ${code}`));
    });
  });
}

async function findVanitySalt(body) {
  const suffix = String(body.suffix ?? "5555").toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,4}$/.test(suffix)) {
    throw new Error("suffix must be 1-4 hex characters.");
  }

  const creator = normalizeAddress(body.creator);
  const params = normalizeLaunchParams(body.params ?? {});
  const maxIterations = Math.min(Number(body.maxIterations ?? 120000), 500000);
  const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode);
  const rewardToken = params.rewardToken === ZeroAddress ? process.env.DEFAULT_REWARD_TOKEN ?? "0x55d398326f99059fF775485246999027B3197955" : params.rewardToken;
  const platformFeeReceiver = getAddress(await factory.feeRecipient());
  const tokenDeployer = getAddress(await factory.tokenDeployer());
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
      fundFeeBps: params.fundFeeBps,
      lpFeeBps: params.lpFeeBps,
      dividendFeeBps: params.dividendFeeBps,
      burnFeeBps: params.burnFeeBps,
    },
    factoryAddress,
  );
  const initCodeHash = keccak256(deployTx.data);
  const startedAt = Date.now();

  for (let attempts = 1; attempts <= maxIterations; attempts += 1) {
    const salt = hexlify(randomBytes(32));
    const tokenSalt = solidityPackedKeccak256(
      ["address", "bytes32", "string", "string", "uint256"],
      [creator, salt, params.name, params.symbol, chainId],
    );
    const tokenAddress = getCreate2Address(tokenDeployer, tokenSalt, initCodeHash);
    if (tokenAddress.toLowerCase().endsWith(suffix)) {
      return {
        ok: true,
        suffix,
        salt,
        tokenSalt,
        tokenAddress,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    suffix,
    attempts: maxIterations,
    elapsedMs: Date.now() - startedAt,
  };
}

function normalizeLaunchParams(params) {
  return {
    name: requiredString(params.name, "params.name"),
    symbol: requiredString(params.symbol, "params.symbol"),
    metadataUri: String(params.metadataUri ?? ""),
    totalSupply: requiredBigInt(params.totalSupply, "params.totalSupply"),
    mintCount: requiredBigInt(params.mintCount, "params.mintCount"),
    mintPrice: requiredBigInt(params.mintPrice, "params.mintPrice"),
    paymentToken: normalizeAddress(params.paymentToken ?? ZeroAddress),
    rewardToken: normalizeAddress(params.rewardToken ?? ZeroAddress),
    rewardThreshold: BigInt(params.rewardThreshold ?? 0),
    receiver: normalizeAddress(params.receiver),
    templateId: normalizeTemplateId(params.templateId ?? "standard"),
    buyTaxBps: Number(params.buyTaxBps ?? 0),
    sellTaxBps: Number(params.sellTaxBps ?? 0),
    fundFeeBps: Number(params.fundFeeBps ?? 0),
    lpFeeBps: Number(params.lpFeeBps ?? 0),
    dividendFeeBps: Number(params.dividendFeeBps ?? 0),
    burnFeeBps: Number(params.burnFeeBps ?? 0),
    whitelistMintCount: BigInt(params.whitelistMintCount ?? 0),
    whitelistEnabled: Boolean(params.whitelistEnabled),
  };
}

async function assertFactoryProject(token) {
  const project = await factory.getProject(token);
  if (String(project.token).toLowerCase() !== token.toLowerCase()) {
    throw new Error("Token is not indexed by the configured Factory.");
  }
}

function normalizeAddress(value) {
  if (!isAddress(String(value ?? ""))) {
    throw new Error(`Invalid address: ${value}`);
  }
  return getAddress(value);
}

function requiredString(value, label) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function requiredBigInt(value, label) {
  const next = BigInt(value ?? 0);
  if (next <= 0n) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return next;
}

function normalizeTemplateId(value) {
  const text = String(value ?? "standard");
  return /^0x[0-9a-fA-F]{64}$/.test(text) ? text : id(text);
}

function requireToken(request) {
  if (!backendToken) {
    return;
  }
  const header = request.headers.authorization ?? "";
  if (header !== `Bearer ${backendToken}`) {
    throw new Error("Unauthorized.");
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload, jsonReplacer));
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", process.env.APPLE_CORS_ORIGIN ?? "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing ${filePath}. Run npm run contracts:compile first.`);
  }
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
