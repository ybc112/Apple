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
import { BNB_CHAIN, USDT_ADDRESS } from '../data'
import type { LaunchDraft, LaunchProject } from '../types'
import type { EthereumProvider } from '../wallet'

export type LaunchpadLocale = 'zh' | 'en'

const configuredVanitySuffix = String(import.meta.env.VITE_VANITY_SUFFIX ?? '')
  .trim()
  .replace(/^0x/i, '')
  .toLowerCase()

export const launchpadConfig = {
  chainId: Number(import.meta.env.VITE_LAUNCHPAD_CHAIN_ID ?? 56),
  factoryAddress: String(import.meta.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ?? ''),
  creationFeeWei: String(import.meta.env.VITE_LAUNCHPAD_CREATION_FEE_WEI ?? '5000000000000000'),
  hiddenProjectTokens: String(import.meta.env.VITE_HIDDEN_PROJECT_TOKENS ?? ''),
  backendUrl: normalizeBackendBaseUrl(String(import.meta.env.VITE_APP_BACKEND_URL ?? '')),
  vanitySuffix: configuredVanitySuffix && configuredVanitySuffix !== '5555' ? configuredVanitySuffix : 'aaaa',
  contractAdapterReady: true,
}

const hiddenProjectTokens = new Set(
  launchpadConfig.hiddenProjectTokens
    .split(/[\s,;]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => isAddress(token)),
)

const hiddenProjectShortMatches = [
  { prefix: '0x3942', suffix: '2a6a' },
  { prefix: '0x6b1d', suffix: 'e701' },
]

const BPS_DENOMINATOR = 10_000n
const MINT_GAS_BUFFER_BPS = 12_500n
const GAS_PRICE_BUFFER_BPS = 10_500n
const NATIVE_MINT_GAS_FLOOR = 4_600_000n

export const isLaunchpadConfigured =
  Boolean(launchpadConfig.factoryAddress) &&
  isAddress(launchpadConfig.factoryAddress) &&
  launchpadConfig.contractAdapterReady

export const launchFactoryAbi = [
  'function createLaunch((string name,string symbol,string metadataUri,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,address paymentToken,address rewardToken,uint256 rewardThreshold,address receiver,bytes32 templateId,uint16 buyTaxBps,uint16 sellTaxBps,uint16 fundFeeBps,uint16 lpFeeBps,uint16 dividendFeeBps,uint16 burnFeeBps,uint256 whitelistMintCount,bool whitelistEnabled) params, bytes32 salt) payable returns (address token, address vault)',
  'function allTokensLength() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function getProject(address token) view returns ((address creator,address token,address vault,address paymentToken,address receiver,address platformFeeReceiver,bytes32 templateId,uint256 totalSupply,uint256 mintCount,uint256 whitelistMintCount,uint256 publicMintCount,uint256 mintPrice,bool whitelistEnabled,string metadataUri,uint64 createdAt,address rewardToken,uint256 rewardThreshold,uint16 buyTaxBps,uint16 sellTaxBps,uint16 fundFeeBps,uint16 lpFeeBps,uint16 dividendFeeBps,uint16 burnFeeBps))',
  'function projects(address) view returns (address creator,address token,address vault,address paymentToken,address receiver,address platformFeeReceiver,bytes32 templateId,uint256 totalSupply,uint256 mintCount,uint256 whitelistMintCount,uint256 publicMintCount,uint256 mintPrice,bool whitelistEnabled,string metadataUri,uint64 createdAt,address rewardToken,uint256 rewardThreshold,uint16 buyTaxBps,uint16 sellTaxBps,uint16 fundFeeBps,uint16 lpFeeBps,uint16 dividendFeeBps,uint16 burnFeeBps)',
  'event LaunchCreated(address indexed creator,address indexed token,address indexed vault,bytes32 templateId,string name,string symbol,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,address paymentToken,bool whitelistEnabled,string metadataUri)',
] as const

const legacyLaunchFactoryAbi = [
  'function allTokensLength() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function projects(address) view returns (address creator,address token,address vault,address paymentToken,address receiver,bytes32 templateId,uint256 totalSupply,uint256 mintCount,uint256 mintPrice,bool whitelistEnabled,string metadataUri,uint64 createdAt)',
] as const

const tokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
] as const

const mintVaultAbi = [
  'function mintedCount() view returns (uint256)',
  'function totalMints() view returns (uint256)',
  'function whitelistMintLimit() view returns (uint256)',
  'function publicMintLimit() view returns (uint256)',
  'function whitelistMintedCount() view returns (uint256)',
  'function publicMintedCount() view returns (uint256)',
  'function refundDeadline() view returns (uint256)',
  'function finalized() view returns (bool)',
  'function tokensPerMint() view returns (uint256)',
  'function mintedByWallet(address account) view returns (uint256)',
  'function paidByWallet(address account) view returns (uint256)',
  'function whitelistList(address account) view returns (bool)',
  'function whitelistRemaining(address account) view returns (uint256)',
  'function totalWhitelistAllowance() view returns (uint256)',
] as const

const mintVaultWriteAbi = [
  'function setWhitelistAccount(address account,bool listed)',
  'function setWhitelistAccounts(address[] accounts,bool listed)',
  'function setWhitelistAllowance(address account,uint256 allowance)',
  'function setWhitelistAllowances(address[] accounts,uint256[] allowances)',
  'function claimRefund()',
  'function mint(uint256 quantity) payable',
] as const

const tokenWriteAbi = [
  'function approve(address spender,uint256 amount) returns (bool)',
] as const

export type LaunchTransactionResult = {
  hash: string
  salt?: string
  predictedTokenAddress?: string
  vanitySuffix?: string
  vanityAttempts?: number
}

export type WhitelistAllowanceEntry = {
  account: string
  allowance: string
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
  whitelistMintCount: bigint
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
  logs?: Array<{
    address?: string
    data: string
    topics: string[]
  }>
}

type VanitySaltResult = {
  ok: boolean
  suffix?: string
  salt?: string
  tokenAddress?: string
  attempts?: number
}

const messages = {
  zh: {
    factoryMissing: '发射工厂未配置：请先部署 Factory，并设置 VITE_LAUNCHPAD_FACTORY_ADDRESS。',
    wrongNetwork: '当前钱包网络不是 BNB Smart Chain，请先切换网络。',
    connectWallet: '请先连接钱包。',
    txFailed: '链上交易执行失败，请在区块浏览器查看失败原因。',
    txTimeout: '交易已提交，但等待确认超时。稍后刷新列表即可看到已确认项目。',
    requiredName: '请先填写代币名称和符号。',
    requiredMint: '请先填写发行量、公开份数、白名单份数和单次 mint 价格。',
    invalidSupply: '发行量必须大于 0。',
    invalidMintCount: 'mint 次数必须是大于 0 的整数。',
    invalidMintQuota: '公开份数和白名单份数加起来必须大于 0。',
    whitelistNeedsQuota: '开启白名单时，白名单份数必须大于 0。',
    invalidMintPrice: '单次 mint 价格不能为负数。',
    invalidReceiver: '请填写有效的项目接收钱包。',
    allocationOverflow: '税收分配总和不能超过 100%。',
    taxTooHigh: '当前合约限制买卖税最高 25%。',
    invalidAddress: (label: string) => `${label}无效。`,
    paymentToken: '付款代币地址',
    rewardToken: '分红代币地址',
    receiver: '接收钱包',
    invalidWhitelistAccount: '请填写有效的白名单钱包。',
    invalidWhitelistAllowance: '白名单地址必须写入列表。',
    emptyWhitelistBatch: '请至少粘贴一个白名单钱包地址。',
    tooManyWhitelistAccounts: '单次最多提交 200 个白名单地址。',
    invalidVault: 'Vault 地址无效。',
    invalidRefundAmount: '退款代币数量无效。',
    invalidMintQuantity: 'Mint 数量必须是大于 0 的整数。',
    invalidPaymentToken: '付款代币地址无效。',
    mintEstimateFailed: '当前无法预估 Mint Gas。请确认当前钱包是否在白名单列表、公开阶段是否已开放、钱包余额是否足够，并刷新页面后重试。',
    vanityUnavailable: '本次没有匹配到 AAAA 靓号地址，请重新点击部署再试一次。',
  },
  en: {
    factoryMissing: 'Launch Factory is not configured. Deploy the Factory and set VITE_LAUNCHPAD_FACTORY_ADDRESS first.',
    wrongNetwork: 'The connected wallet is not on BNB Smart Chain. Please switch networks first.',
    connectWallet: 'Please connect your wallet first.',
    txFailed: 'The on-chain transaction failed. Check the block explorer for the failure reason.',
    txTimeout: 'The transaction was submitted, but confirmation timed out. Refresh the list later to see confirmed projects.',
    requiredName: 'Please enter the token name and symbol first.',
    requiredMint: 'Please enter total supply, public count, whitelist count, and price per mint first.',
    invalidSupply: 'Total supply must be greater than 0.',
    invalidMintCount: 'Mint count must be an integer greater than 0.',
    invalidMintQuota: 'Public and whitelist mint counts must add up to more than 0.',
    whitelistNeedsQuota: 'Whitelist mint count must be greater than 0 when whitelist mode is enabled.',
    invalidMintPrice: 'Price per mint cannot be negative.',
    invalidReceiver: 'Please enter a valid project receiver wallet.',
    allocationOverflow: 'Tax allocation cannot exceed 100%.',
    taxTooHigh: 'The current contract limits buy/sell tax to 25%.',
    invalidAddress: (label: string) => `${label} is invalid.`,
    paymentToken: 'Payment token address',
    rewardToken: 'Reward token address',
    receiver: 'Receiver wallet',
    invalidWhitelistAccount: 'Please enter a valid whitelist wallet.',
    invalidWhitelistAllowance: 'Whitelist wallet must be listed.',
    emptyWhitelistBatch: 'Paste at least one whitelist wallet address.',
    tooManyWhitelistAccounts: 'Submit no more than 200 whitelist addresses at once.',
    invalidVault: 'Vault address is invalid.',
    invalidRefundAmount: 'Refund token amount is invalid.',
    invalidMintQuantity: 'Mint quantity must be an integer greater than 0.',
    invalidPaymentToken: 'Payment token address is invalid.',
    mintEstimateFailed: 'Unable to estimate mint gas. Check whitelist list status, public phase status, wallet balance, then refresh and try again.',
    vanityUnavailable: 'Could not match an AAAA vanity address this time. Click deploy again to retry.',
  },
} as const

export async function createLaunchToken(
  provider: EthereumProvider,
  draft: LaunchDraft,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]
  validateDraftForContract(draft, locale)

  if (!isLaunchpadConfigured) {
    throw new Error(text.factoryMissing)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const params = toFactoryParams(draft, locale)
  const iface = new Interface(launchFactoryAbi)
  const vanity = await resolveLaunchSalt(from, params, locale)
  const salt = vanity.salt
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

  return {
    hash,
    salt,
    predictedTokenAddress: vanity.predictedTokenAddress,
    vanitySuffix: vanity.vanitySuffix,
    vanityAttempts: vanity.vanityAttempts,
  }
}

export async function waitForTransactionReceipt(
  provider: EthereumProvider,
  hash: string,
  timeoutMs = 120_000,
  locale: LaunchpadLocale = 'zh',
) {
  const text = messages[locale]
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = (await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    })) as TransactionReceipt | null

    if (receipt) {
      if (receipt.status && receipt.status !== '0x1') {
        throw new Error(text.txFailed)
      }

      return receipt
    }

    await delay(3_000)
  }

  throw new Error(text.txTimeout)
}

export function readLaunchCreatedToken(receipt: TransactionReceipt | null | undefined) {
  if (!receipt?.logs?.length || !isAddress(launchpadConfig.factoryAddress)) {
    return ''
  }

  const iface = new Interface(launchFactoryAbi)
  for (const log of receipt.logs) {
    if (log.address && log.address.toLowerCase() !== launchpadConfig.factoryAddress.toLowerCase()) {
      continue
    }

    try {
      const parsed = iface.parseLog({ data: log.data, topics: log.topics })
      if (parsed?.name === 'LaunchCreated' && isAddress(String(parsed.args.token))) {
        return String(parsed.args.token)
      }
    } catch {
      // Ignore non-Factory logs in the same receipt.
    }
  }

  return ''
}

export async function queueProjectVerification(tokenAddress: string) {
  if (!launchpadConfig.backendUrl || !isAddress(tokenAddress)) {
    return { ok: false, skipped: true }
  }

  const response = await fetch(buildBackendUrl('/api/verify-project'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenAddress }),
  })

  if (!response.ok) {
    return { ok: false, skipped: true }
  }

  return (await response.json()) as { ok: boolean; token?: string }
}

export async function setProjectWhitelistAllowance(
  provider: EthereumProvider,
  vaultAddress: string,
  account: string,
  allowance: string,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(vaultAddress)) {
    throw new Error(text.invalidAddress('Vault'))
  }
  if (!isAddress(account)) {
    throw new Error(text.invalidWhitelistAccount)
  }
  if (!Number.isInteger(Number(allowance)) || Number(allowance) <= 0) {
    throw new Error(text.invalidWhitelistAllowance)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const iface = new Interface(mintVaultWriteAbi)
  const data = iface.encodeFunctionData('setWhitelistAllowance', [account, BigInt(allowance)])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: vaultAddress,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function setProjectWhitelistAllowances(
  provider: EthereumProvider,
  vaultAddress: string,
  entries: WhitelistAllowanceEntry[],
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(vaultAddress)) {
    throw new Error(text.invalidAddress('Vault'))
  }
  if (entries.length <= 0) {
    throw new Error(text.emptyWhitelistBatch)
  }
  if (entries.length > 200) {
    throw new Error(text.tooManyWhitelistAccounts)
  }

  const accounts = entries.map((entry) => {
    if (!isAddress(entry.account)) {
      throw new Error(text.invalidWhitelistAccount)
    }
    return entry.account
  })
  const allowances = entries.map((entry) => {
    if (!/^\d+$/.test(entry.allowance.trim()) || BigInt(entry.allowance.trim()) <= 0n) {
      throw new Error(text.invalidWhitelistAllowance)
    }
    return BigInt(entry.allowance.trim())
  })

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const walletAccounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = walletAccounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const iface = new Interface(mintVaultWriteAbi)
  const data = iface.encodeFunctionData('setWhitelistAllowances', [accounts, allowances])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: vaultAddress,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function claimProjectRefund(
  provider: EthereumProvider,
  vaultAddress: string,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(vaultAddress)) {
    throw new Error(text.invalidVault)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const iface = new Interface(mintVaultWriteAbi)
  const data = iface.encodeFunctionData('claimRefund', [])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: vaultAddress,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function approveProjectRefundTokens(
  provider: EthereumProvider,
  tokenAddress: string,
  vaultAddress: string,
  tokenAmount: string,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(tokenAddress)) {
    throw new Error(text.invalidAddress('Token'))
  }
  if (!isAddress(vaultAddress)) {
    throw new Error(text.invalidVault)
  }

  const amount = BigInt(tokenAmount || '0')
  if (amount <= 0n) {
    throw new Error(text.invalidRefundAmount)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const iface = new Interface(tokenWriteAbi)
  const data = iface.encodeFunctionData('approve', [vaultAddress, amount])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: tokenAddress,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function approveProjectMintPayment(
  provider: EthereumProvider,
  paymentToken: string,
  vaultAddress: string,
  paymentAmount: string,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(paymentToken) || paymentToken.toLowerCase() === ZeroAddress) {
    throw new Error(text.invalidPaymentToken)
  }
  if (!isAddress(vaultAddress)) {
    throw new Error(text.invalidVault)
  }

  const amount = BigInt(paymentAmount || '0')
  if (amount <= 0n) {
    throw new Error(text.invalidMintQuantity)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const iface = new Interface(tokenWriteAbi)
  const data = iface.encodeFunctionData('approve', [vaultAddress, amount])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: paymentToken,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function mintLaunchProject(
  provider: EthereumProvider,
  project: LaunchProject,
  quantity: string,
  locale: LaunchpadLocale = 'zh',
): Promise<LaunchTransactionResult> {
  const text = messages[locale]

  if (!isAddress(project.vault)) {
    throw new Error(text.invalidVault)
  }
  if (!/^\d+$/.test(quantity.trim()) || BigInt(quantity.trim()) <= 0n) {
    throw new Error(text.invalidMintQuantity)
  }

  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== launchpadConfig.chainId) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  const mintQuantity = BigInt(quantity.trim())
  const cost = BigInt(project.mintPriceWei || '0') * mintQuantity
  const iface = new Interface(mintVaultWriteAbi)
  const data = iface.encodeFunctionData('mint', [mintQuantity])
  const tx = {
    from,
    to: project.vault,
    value: project.paymentToken.toLowerCase() === ZeroAddress ? toBeHex(cost) : '0x0',
    data,
  }
  const isNativeMint = project.paymentToken.toLowerCase() === ZeroAddress
  let gas: string
  let gasPrice: string | undefined

  try {
    await assertMintCanExecute(tx)
  } catch {
    throw new Error(text.mintEstimateFailed)
  }

  try {
    const estimatedGas = await estimateMintGas(tx)
    const bufferedGas = (estimatedGas * MINT_GAS_BUFFER_BPS) / BPS_DENOMINATOR
    const nativeGas = isNativeMint && bufferedGas < NATIVE_MINT_GAS_FLOOR
      ? NATIVE_MINT_GAS_FLOOR
      : bufferedGas
    gas = toBeHex(nativeGas)
  } catch {
    if (!isNativeMint) {
      throw new Error(text.mintEstimateFailed)
    }
    gas = toBeHex(NATIVE_MINT_GAS_FLOOR)
  }

  try {
    const readProvider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
    const currentGasPrice = BigInt(String(await readProvider.send('eth_gasPrice', [])))
    gasPrice = toBeHex((currentGasPrice * GAS_PRICE_BUFFER_BPS) / BPS_DENOMINATOR)
  } catch {
    gasPrice = undefined
  }

  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        ...tx,
        gas,
        ...(gasPrice ? { gasPrice } : {}),
      },
    ],
  })) as string

  return { hash }
}

async function assertMintCanExecute(
  tx: { from: string; to: string; value: string; data: string },
) {
  const rpcProvider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
  await rpcProvider.send('eth_call', [tx, 'latest'])
}

async function estimateMintGas(
  tx: { from: string; to: string; value: string; data: string },
) {
  const rpcProvider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
  return BigInt(String(await rpcProvider.send('eth_estimateGas', [tx])))
}

export async function fetchLaunchProjects(account = ''): Promise<LaunchProject[]> {
  if (!isLaunchpadConfigured) {
    return []
  }

  const provider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
  const factory = new Contract(launchpadConfig.factoryAddress, launchFactoryAbi, provider)
  const legacyFactory = new Contract(launchpadConfig.factoryAddress, legacyLaunchFactoryAbi, provider)
  const count = Number(await factory.allTokensLength())
  const start = Math.max(0, count - 24)
  const projects: LaunchProject[] = []

  for (let index = count - 1; index >= start; index -= 1) {
    const tokenAddress = String(await factory.allTokens(index))
    if (isHiddenLaunchProject(tokenAddress)) {
      continue
    }

    const project = await readProject(factory, legacyFactory, tokenAddress)
    const creator = String(project.creator ?? project[0])
    const vaultAddress = String(project.vault ?? project[2])
    const paymentToken = String(project.paymentToken ?? project[3])
    const receiver = String(project.receiver ?? project[4])
    const hasPlatformFeeShape = project.platformFeeReceiver !== undefined
    const fieldOffset = hasPlatformFeeShape ? 1 : 0
    const platformFeeReceiver = hasPlatformFeeShape ? String(project.platformFeeReceiver ?? project[5] ?? ZeroAddress) : ZeroAddress
    const platformFeeBps = hasPlatformFeeShape ? 1000 : 0
    const totalSupply = BigInt(project.totalSupply ?? project[6 + fieldOffset] ?? 0)
    const mintCount = BigInt(project.mintCount ?? project[7 + fieldOffset] ?? 0)
    const hasNewProjectShape = project.whitelistMintCount !== undefined
    const whitelistMintCount = hasNewProjectShape ? BigInt(project.whitelistMintCount ?? project[8 + fieldOffset] ?? 0) : 0n
    const publicMintCount = hasNewProjectShape ? BigInt(project.publicMintCount ?? project[9 + fieldOffset] ?? 0) : mintCount
    const mintPrice = BigInt(hasNewProjectShape ? project.mintPrice ?? project[10 + fieldOffset] ?? 0 : project.mintPrice ?? project[8] ?? 0)
    const whitelistEnabled = Boolean(hasNewProjectShape ? project.whitelistEnabled ?? project[11 + fieldOffset] : project.whitelistEnabled ?? project[9])
    const metadataUri = String(hasNewProjectShape ? project.metadataUri ?? project[12 + fieldOffset] ?? '' : project.metadataUri ?? project[10] ?? '')
    const createdAt = Number(hasNewProjectShape ? project.createdAt ?? project[13 + fieldOffset] ?? 0 : project.createdAt ?? project[11] ?? 0)
    const rewardToken = hasNewProjectShape ? String(project.rewardToken ?? project[14 + fieldOffset] ?? ZeroAddress) : ZeroAddress
    const rewardThreshold = hasNewProjectShape ? BigInt(project.rewardThreshold ?? project[15 + fieldOffset] ?? 0) : 0n
    const buyTaxBps = hasNewProjectShape ? Number(project.buyTaxBps ?? project[16 + fieldOffset] ?? 0) : 0
    const sellTaxBps = hasNewProjectShape ? Number(project.sellTaxBps ?? project[17 + fieldOffset] ?? 0) : 0
    const fundFeeBps = hasNewProjectShape ? Number(project.fundFeeBps ?? project[18 + fieldOffset] ?? 0) : 0
    const lpFeeBps = hasNewProjectShape ? Number(project.lpFeeBps ?? project[19 + fieldOffset] ?? 0) : 0
    const dividendFeeBps = hasNewProjectShape ? Number(project.dividendFeeBps ?? project[20 + fieldOffset] ?? 0) : 0
    const burnFeeBps = hasNewProjectShape ? Number(project.burnFeeBps ?? project[21 + fieldOffset] ?? 0) : 0

    const token = new Contract(tokenAddress, tokenAbi, provider)
    const vault = new Contract(vaultAddress, mintVaultAbi, provider)

    const [
      name,
      symbol,
      mintedCount,
      whitelistMintedCount,
      publicMintedCount,
      vaultWhitelistLimit,
      vaultPublicLimit,
      refundDeadline,
      finalized,
      tokensPerMint,
      userMintedCount,
      userPaid,
      refundAllowance,
      whitelistRemaining,
      totalWhitelistAllowance,
      mintPaymentAllowance,
      vaultTokenBalance,
    ] = await Promise.all([
      token.name().catch(() => 'Unknown'),
      token.symbol().catch(() => 'TOKEN'),
      vault.mintedCount().catch(() => 0n),
      vault.whitelistMintedCount().catch(() => 0n),
      vault.publicMintedCount().catch(() => 0n),
      vault.whitelistMintLimit().catch(() => whitelistMintCount),
      vault.publicMintLimit().catch(() => publicMintCount),
      vault.refundDeadline().catch(() => 0n),
      vault.finalized().catch(() => false),
      vault.tokensPerMint().catch(() => (mintCount > 0n ? totalSupply / mintCount : 0n)),
      account && isAddress(account) ? vault.mintedByWallet(account).catch(() => 0n) : 0n,
      account && isAddress(account) ? vault.paidByWallet(account).catch(() => 0n) : 0n,
      account && isAddress(account) ? token.allowance(account, vaultAddress).catch(() => 0n) : 0n,
      account && isAddress(account) ? vault.whitelistRemaining(account).catch(() => 0n) : 0n,
      vault.totalWhitelistAllowance().catch(() => 0n),
      account && isAddress(account) && paymentToken.toLowerCase() !== ZeroAddress
        ? new Contract(paymentToken, tokenAbi, provider).allowance(account, vaultAddress).catch(() => 0n)
        : 0n,
      token.balanceOf(vaultAddress).catch(() => 0n),
    ])

    const mintedCountValue = BigInt(mintedCount)
    const userMintedCountValue = BigInt(userMintedCount)
    const refundTokenAmount = BigInt(tokensPerMint) * userMintedCountValue
    const canRefund =
      !Boolean(finalized) &&
      Number(refundDeadline) > 0 &&
      Date.now() >= Number(refundDeadline) * 1000 &&
      BigInt(userPaid) > 0n &&
      refundTokenAmount > 0n
    const progress =
      mintCount > 0n ? Math.min(100, Number((mintedCountValue * 10_000n) / mintCount) / 100) : 0
    const metadata = parseMetadata(metadataUri)

    projects.push({
      creator,
      token: tokenAddress,
      vault: vaultAddress,
      paymentToken,
      receiver,
      platformFeeReceiver,
      platformFeeBps,
      name: String(name),
      symbol: String(symbol),
      description: metadata.description || '链上发射项目',
      website: metadata.website || '',
      telegram: metadata.telegram || '',
      xLink: metadata.x || metadata.xLink || '',
      totalSupply: formatUnits(totalSupply, 18),
      mintCount: mintCount.toString(),
      whitelistMintCount: BigInt(vaultWhitelistLimit).toString(),
      publicMintCount: BigInt(vaultPublicLimit).toString(),
      mintPrice: formatMintPrice(mintPrice, paymentToken),
      mintPriceWei: mintPrice.toString(),
      paymentSymbol: getPaymentSymbol(paymentToken),
      mintedCount: mintedCountValue.toString(),
      whitelistMintedCount: BigInt(whitelistMintedCount).toString(),
      publicMintedCount: BigInt(publicMintedCount).toString(),
      refundDeadline: Number(refundDeadline),
      finalized: Boolean(finalized),
      userMintedCount: userMintedCountValue.toString(),
      refundTokenAmount: refundTokenAmount.toString(),
      refundNeedsApproval: canRefund && BigInt(refundAllowance) < refundTokenAmount,
      userRefundAmount: formatRefundAmount(BigInt(userPaid), paymentToken),
      canRefund,
      whitelistRemaining: BigInt(whitelistRemaining).toString(),
      totalWhitelistAllowance: BigInt(totalWhitelistAllowance).toString(),
      mintPaymentAllowance: BigInt(mintPaymentAllowance).toString(),
      rewardToken,
      rewardThreshold: formatUnits(rewardThreshold, 18),
      buyTaxBps,
      sellTaxBps,
      fundFeeBps,
      lpFeeBps,
      dividendFeeBps,
      burnFeeBps,
      vaultTokenBalance: formatUnits(BigInt(vaultTokenBalance), 18),
      progress,
      whitelistEnabled,
      createdAt,
    })
  }

  return projects
}

function toFactoryParams(draft: LaunchDraft, locale: LaunchpadLocale): FactoryLaunchParams {
  const text = messages[locale]
  const form = draft.form
  const paymentToken = normalizeAddress(form.paymentToken || ZeroAddress, text.paymentToken, locale)
  const rewardToken = normalizeAddress(form.rewardToken || USDT_ADDRESS, text.rewardToken, locale)
  const receiver = normalizeAddress(form.receiverWallet, text.receiver, locale)
  const mintPrice =
    paymentToken.toLowerCase() === ZeroAddress ? parseEther(form.mintPrice) : parseUnits(form.mintPrice, 18)
  const mintQuota = readMintQuota(draft, locale)

  return {
    name: form.tokenName.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    metadataUri: buildMetadata(draft),
    totalSupply: parseUnits(form.supply, 18),
    mintCount: mintQuota.total,
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
    whitelistMintCount: mintQuota.whitelist,
    whitelistEnabled: draft.whitelistEnabled || mintQuota.whitelist > 0n,
  }
}

async function resolveLaunchSalt(
  creator: string,
  params: FactoryLaunchParams,
  locale: LaunchpadLocale,
) {
  const text = messages[locale]
  const fallback = {
    salt: hexlify(randomBytes(32)),
    predictedTokenAddress: '',
    vanitySuffix: '',
    vanityAttempts: 0,
  }

  if (!launchpadConfig.backendUrl || !launchpadConfig.vanitySuffix) {
    return fallback
  }

  try {
    const response = await fetch(buildBackendUrl('/api/vanity-salt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        suffix: launchpadConfig.vanitySuffix,
        maxIterations: 500000,
        creator,
        params: serializeFactoryParams(params),
      }),
    })

    if (!response.ok) {
      throw new Error(text.vanityUnavailable)
    }

    const result = (await response.json()) as VanitySaltResult
    if (!result.ok || !result.salt || !/^0x[0-9a-fA-F]{64}$/.test(result.salt)) {
      throw new Error(text.vanityUnavailable)
    }

    return {
      salt: result.salt,
      predictedTokenAddress: result.tokenAddress && isAddress(result.tokenAddress) ? result.tokenAddress : '',
      vanitySuffix: result.suffix ?? launchpadConfig.vanitySuffix,
      vanityAttempts: Number(result.attempts ?? 0),
    }
  } catch (error) {
    if (error instanceof Error && error.message === text.vanityUnavailable) {
      throw error
    }

    throw new Error(text.vanityUnavailable)
  }
}

function serializeFactoryParams(params: FactoryLaunchParams) {
  return {
    ...params,
    totalSupply: params.totalSupply.toString(),
    mintCount: params.mintCount.toString(),
    mintPrice: params.mintPrice.toString(),
    rewardThreshold: params.rewardThreshold.toString(),
    whitelistMintCount: params.whitelistMintCount.toString(),
  }
}

function validateDraftForContract(draft: LaunchDraft, locale: LaunchpadLocale) {
  const text = messages[locale]
  const form = draft.form

  if (!form.tokenName.trim() || !form.symbol.trim()) {
    throw new Error(text.requiredName)
  }

  if (!form.supply || !form.mintPrice) {
    throw new Error(text.requiredMint)
  }

  if (!Number.isFinite(Number(form.supply)) || Number(form.supply) <= 0) {
    throw new Error(text.invalidSupply)
  }

  readMintQuota(draft, locale)

  if (!Number.isFinite(Number(form.mintPrice)) || Number(form.mintPrice) < 0) {
    throw new Error(text.invalidMintPrice)
  }

  if (!isAddress(form.receiverWallet)) {
    throw new Error(text.invalidReceiver)
  }

  const totalAllocation =
    draft.allocation.marketing +
    draft.allocation.liquidity +
    draft.allocation.rewards +
    draft.allocation.burn

  if (totalAllocation > 100) {
    throw new Error(text.allocationOverflow)
  }

  if (draft.buyTax > 25 || draft.sellTax > 25) {
    throw new Error(text.taxTooHigh)
  }
}

function readMintQuota(draft: LaunchDraft, locale: LaunchpadLocale) {
  const text = messages[locale]
  const publicCount = parseMintCount(draft.form.publicMintCount || '0', text.invalidMintCount)
  const whitelistCount = parseMintCount(draft.form.whitelistMintCount || '0', text.invalidMintCount)
  const total = publicCount + whitelistCount

  if (total <= 0n) {
    throw new Error(text.invalidMintQuota)
  }
  if (draft.whitelistEnabled && whitelistCount <= 0n) {
    throw new Error(text.whitelistNeedsQuota)
  }

  return {
    public: publicCount,
    whitelist: whitelistCount,
    total,
  }
}

function parseMintCount(value: string, errorMessage: string) {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(errorMessage)
  }

  return BigInt(value.trim())
}

function normalizeAddress(address: string, label: string, locale: LaunchpadLocale) {
  const nextAddress = address.trim()

  if (!isAddress(nextAddress)) {
    throw new Error(messages[locale].invalidAddress(label))
  }

  return nextAddress
}

async function readProject(factory: Contract, legacyFactory: Contract, tokenAddress: string) {
  try {
    return await factory.getProject(tokenAddress)
  } catch {
    return legacyFactory.projects(tokenAddress)
  }
}

function isHiddenLaunchProject(tokenAddress: string) {
  const normalizedToken = tokenAddress.toLowerCase()

  return (
    hiddenProjectTokens.has(normalizedToken) ||
    hiddenProjectShortMatches.some(
      ({ prefix, suffix }) => normalizedToken.startsWith(prefix) && normalizedToken.endsWith(suffix),
    )
  )
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
  return `${paymentToken.toLowerCase() === ZeroAddress ? formatEther(value) : formatUnits(value, 18)} ${getPaymentSymbol(paymentToken)}`
}

function formatRefundAmount(value: bigint, paymentToken: string) {
  if (value <= 0n) {
    return ''
  }

  return `${paymentToken.toLowerCase() === ZeroAddress ? formatEther(value) : formatUnits(value, 18)} ${getPaymentSymbol(paymentToken)}`
}

function getPaymentSymbol(paymentToken: string) {
  if (paymentToken.toLowerCase() === ZeroAddress) {
    return 'BNB'
  }

  return paymentToken.toLowerCase() === USDT_ADDRESS.toLowerCase() ? 'USDT' : 'TOKEN'
}

function normalizeBackendBaseUrl(value: string) {
  const nextValue = value.trim()
  if (nextValue === 'same-origin' && globalThis.location?.origin) {
    return globalThis.location.origin
  }

  return nextValue.replace(/\/+$/, '')
}

function buildBackendUrl(path: string) {
  return `${launchpadConfig.backendUrl}${path}`
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}
