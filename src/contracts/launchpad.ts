import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  formatUnits,
  hexlify,
  id,
  isAddress,
  parseEther,
  parseUnits,
  randomBytes,
  toBeHex,
} from 'ethers'
import { BNB_CHAIN } from '../data'
import type { LaunchDraft, LaunchProject } from '../types'
import type { EthereumProvider } from '../wallet'

export const launchpadConfig = {
  chainId: Number(import.meta.env.VITE_LAUNCHPAD_CHAIN_ID ?? 56),
  factoryAddress: String(import.meta.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ?? ''),
  creationFeeWei: String(import.meta.env.VITE_LAUNCHPAD_CREATION_FEE_WEI ?? '5000000000000000'),
  contractAdapterReady: true,
}

export const isLaunchpadConfigured =
  Boolean(launchpadConfig.factoryAddress) &&
  isAddress(launchpadConfig.factoryAddress) &&
  launchpadConfig.contractAdapterReady

export const launchFactoryAbi = [
  'function createLaunch((string name,string symbol,string metadataUri,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,address paymentToken,address rewardToken,uint256 rewardThreshold,address receiver,bytes32 templateId,uint16 buyTaxBps,uint16 sellTaxBps,uint16 fundFeeBps,uint16 lpFeeBps,uint16 dividendFeeBps,uint16 burnFeeBps,bool whitelistEnabled) params, bytes32 salt) payable returns (address token, address vault)',
  'function allTokensLength() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function projects(address) view returns (address creator,address token,address vault,address paymentToken,address receiver,bytes32 templateId,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,bool whitelistEnabled,string metadataUri,uint64 createdAt)',
  'event LaunchCreated(address indexed creator,address indexed token,address indexed vault,bytes32 templateId,string name,string symbol,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,address paymentToken,bool whitelistEnabled,string metadataUri)',
] as const

const tokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
] as const

const mintVaultAbi = [
  'function mintedCount() view returns (uint256)',
  'function totalMints() view returns (uint256)',
] as const

export type LaunchTransactionResult = {
  hash: string
}

type FactoryLaunchParams = {
  name: string
  symbol: string
  metadataUri: string
  totalSupply: bigint
  mintCount: bigint
  mintPrice: bigint
  paymentToken: string
  rewardToken: string
  rewardThreshold: bigint
  receiver: string
  templateId: string
  buyTaxBps: number
  sellTaxBps: number
  fundFeeBps: number
  lpFeeBps: number
  dividendFeeBps: number
  burnFeeBps: number
  whitelistEnabled: boolean
}

type ProjectMetadata = {
  description?: string
  website?: string
  telegram?: string
  x?: string
  xLink?: string
}

type TransactionReceipt = {
  status?: string | null
}

export async function createLaunchToken(
  provider: EthereumProvider,
  draft: LaunchDraft,
): Promise<LaunchTransactionResult> {
  validateDraftForContract(draft)

  if (!isLaunchpadConfigured) {
    throw new Error('发射工厂未配置：请先部署 Factory，并设置 VITE_LAUNCHPAD_FACTORY_ADDRESS。')
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error('当前钱包网络不是 BNB Smart Chain，请先切换网络。')
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error('请先连接钱包。')
  }

  const params = toFactoryParams(draft)
  const iface = new Interface(launchFactoryAbi)
  const salt = hexlify(randomBytes(32))
  const data = iface.encodeFunctionData('createLaunch', [params, salt])

  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: launchpadConfig.factoryAddress,
        value: toBeHex(BigInt(launchpadConfig.creationFeeWei)),
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function waitForTransactionReceipt(
  provider: EthereumProvider,
  hash: string,
  timeoutMs = 120_000,
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = (await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    })) as TransactionReceipt | null

    if (receipt) {
      if (receipt.status && receipt.status !== '0x1') {
        throw new Error('链上交易执行失败，请在区块浏览器查看失败原因。')
      }

      return receipt
    }

    await delay(3_000)
  }

  throw new Error('交易已提交，但等待确认超时。稍后刷新列表即可看到已确认项目。')
}

export async function fetchLaunchProjects(): Promise<LaunchProject[]> {
  if (!isLaunchpadConfigured) {
    return []
  }

  const provider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
  const factory = new Contract(launchpadConfig.factoryAddress, launchFactoryAbi, provider)
  const count = Number(await factory.allTokensLength())
  const start = Math.max(0, count - 24)
  const projects: LaunchProject[] = []

  for (let index = count - 1; index >= start; index -= 1) {
    const tokenAddress = String(await factory.allTokens(index))
    const project = await factory.projects(tokenAddress)
    const creator = String(project.creator ?? project[0])
    const vaultAddress = String(project.vault ?? project[2])
    const paymentToken = String(project.paymentToken ?? project[3])
    const receiver = String(project.receiver ?? project[4])
    const totalSupply = BigInt(project.totalSupply ?? project[6] ?? 0)
    const mintCount = BigInt(project.mintCount ?? project[7] ?? 0)
    const mintPrice = BigInt(project.mintPrice ?? project[8] ?? 0)
    const whitelistEnabled = Boolean(project.whitelistEnabled ?? project[9])
    const metadataUri = String(project.metadataUri ?? project[10] ?? '')
    const createdAt = Number(project.createdAt ?? project[11] ?? 0)

    const token = new Contract(tokenAddress, tokenAbi, provider)
    const vault = new Contract(vaultAddress, mintVaultAbi, provider)

    const [name, symbol, mintedCount] = await Promise.all([
      token.name().catch(() => 'Unknown'),
      token.symbol().catch(() => 'TOKEN'),
      vault.mintedCount().catch(() => 0n),
    ])

    const mintedCountValue = BigInt(mintedCount)
    const progress =
      mintCount > 0n ? Math.min(100, Number((mintedCountValue * 10_000n) / mintCount) / 100) : 0
    const metadata = parseMetadata(metadataUri)

    projects.push({
      creator,
      token: tokenAddress,
      vault: vaultAddress,
      paymentToken,
      receiver,
      name: String(name),
      symbol: String(symbol),
      description: metadata.description || 'Apple Seed launch project',
      website: metadata.website || '',
      telegram: metadata.telegram || '',
      xLink: metadata.x || metadata.xLink || '',
      totalSupply: formatUnits(totalSupply, 18),
      mintCount: mintCount.toString(),
      mintPrice: formatMintPrice(mintPrice, paymentToken),
      mintedCount: mintedCountValue.toString(),
      progress,
      whitelistEnabled,
      createdAt,
    })
  }

  return projects
}

function toFactoryParams(draft: LaunchDraft): FactoryLaunchParams {
  const form = draft.form
  const paymentToken = normalizeAddress(form.paymentToken || ZeroAddress, '付款代币地址')
  const rewardToken = normalizeAddress(form.rewardToken || ZeroAddress, '奖励代币地址')
  const receiver = normalizeAddress(form.receiverWallet, '接收钱包')
  const mintPrice =
    paymentToken.toLowerCase() === ZeroAddress ? parseEther(form.mintPrice) : parseUnits(form.mintPrice, 18)

  return {
    name: form.tokenName.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    metadataUri: buildMetadata(draft),
    totalSupply: parseUnits(form.supply, 18),
    mintCount: BigInt(form.mintCount),
    mintPrice,
    paymentToken,
    rewardToken,
    rewardThreshold: parseUnits(form.rewardThreshold || '0', 18),
    receiver,
    templateId: id(draft.templateId),
    buyTaxBps: percentToBps(draft.buyTax),
    sellTaxBps: percentToBps(draft.sellTax),
    fundFeeBps: percentToBps(draft.allocation.marketing),
    lpFeeBps: percentToBps(draft.allocation.liquidity),
    dividendFeeBps: percentToBps(draft.allocation.rewards),
    burnFeeBps: percentToBps(draft.allocation.burn),
    whitelistEnabled: draft.whitelistEnabled,
  }
}

function validateDraftForContract(draft: LaunchDraft) {
  const form = draft.form

  if (!form.tokenName.trim() || !form.symbol.trim()) {
    throw new Error('请先填写代币名称和符号。')
  }

  if (!form.supply || !form.mintCount || !form.mintPrice) {
    throw new Error('请先填写发行量、mint 次数和单次 mint 价格。')
  }

  if (!Number.isFinite(Number(form.supply)) || Number(form.supply) <= 0) {
    throw new Error('发行量必须大于 0。')
  }

  if (!Number.isInteger(Number(form.mintCount)) || Number(form.mintCount) <= 0) {
    throw new Error('mint 次数必须是大于 0 的整数。')
  }

  if (!Number.isFinite(Number(form.mintPrice)) || Number(form.mintPrice) < 0) {
    throw new Error('单次 mint 价格不能为负数。')
  }

  if (!isAddress(form.receiverWallet)) {
    throw new Error('请填写有效的项目接收钱包。')
  }

  const totalAllocation =
    draft.allocation.marketing +
    draft.allocation.liquidity +
    draft.allocation.rewards +
    draft.allocation.burn

  if (totalAllocation > 100) {
    throw new Error('税收分配总和不能超过 100%。')
  }

  if (draft.buyTax > 25 || draft.sellTax > 25) {
    throw new Error('当前合约限制买卖税最高 25%。')
  }
}

function normalizeAddress(address: string, label: string) {
  const nextAddress = address.trim()

  if (!isAddress(nextAddress)) {
    throw new Error(`${label}无效。`)
  }

  return nextAddress
}

function percentToBps(value: number) {
  return Math.round(value * 100)
}

function buildMetadata(draft: LaunchDraft) {
  return JSON.stringify({
    description: draft.form.description,
    avatar: draft.avatar,
    website: draft.form.website,
    telegram: draft.form.telegram,
    x: draft.form.xLink,
  })
}

function parseMetadata(metadataUri: string): ProjectMetadata {
  try {
    const parsed = JSON.parse(metadataUri) as ProjectMetadata
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function formatMintPrice(value: bigint, paymentToken: string) {
  return paymentToken.toLowerCase() === ZeroAddress ? `${formatEther(value)} BNB` : formatUnits(value, 18)
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}
