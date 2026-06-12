import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  isAddress,
  parseEther,
  parseUnits,
  toQuantity,
} from 'ethers'
import { BNB_CHAIN } from '../data'
import type { EthereumProvider } from '../wallet'

export type PancakeSwapDirection = 'buy' | 'sell'

export type PancakeSwapQuote = {
  amountIn: string
  amountOut: string
  minimumAmountOut: string
  formattedAmountOut: string
  formattedMinimumAmountOut: string
  needsApproval: boolean
  routeLabel: string
  sourceSymbol: string
  targetSymbol: string
  tokenSymbol: string
  tokenDecimals: number
}

export type PancakeSwapRequest = {
  tokenAddress: string
  amount: string
  direction: PancakeSwapDirection
  slippageBps: number
  locale?: PancakeLocale
}

export type PancakeTransactionResult = {
  hash: string
  quote?: PancakeSwapQuote
}

type PancakeLocale = 'zh' | 'en'

export const PANCAKE_V2_ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'

const routerAbi = [
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
] as const

const erc20Abi = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner,address spender) view returns (uint256)',
] as const

const erc20WriteAbi = [
  'function approve(address spender,uint256 amount) returns (bool)',
] as const

const messages = {
  zh: {
    wrongNetwork: '当前钱包网络不是 BNB Smart Chain，请先切换网络。',
    connectWallet: '请先连接钱包。',
    invalidToken: '请输入有效的代币合约地址。',
    invalidAmount: '请输入大于 0 的兑换数量。',
    invalidSlippage: '滑点必须大于 0 且不超过 50%。',
    quoteFailed: '薄饼暂时没有可用报价，请确认这个代币已经添加 BNB 流动性。',
  },
  en: {
    wrongNetwork: 'The connected wallet is not on BNB Smart Chain. Please switch networks first.',
    connectWallet: 'Please connect your wallet first.',
    invalidToken: 'Enter a valid token contract address.',
    invalidAmount: 'Enter a swap amount greater than 0.',
    invalidSlippage: 'Slippage must be greater than 0 and no more than 50%.',
    quoteFailed: 'PancakeSwap has no available quote. Confirm this token has BNB liquidity.',
  },
} as const

export async function fetchPancakeSwapQuote({
  tokenAddress,
  amount,
  direction,
  slippageBps,
  account = '',
  locale = 'zh',
}: PancakeSwapRequest & { account?: string }): Promise<PancakeSwapQuote> {
  const text = messages[locale]
  const normalizedToken = normalizeTokenAddress(tokenAddress, locale)
  const normalizedSlippage = normalizeSlippage(slippageBps, locale)
  const provider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], 56)
  const router = new Contract(PANCAKE_V2_ROUTER_ADDRESS, routerAbi, provider)
  const token = new Contract(normalizedToken, erc20Abi, provider)
  const [tokenSymbol, tokenDecimals] = await Promise.all([
    token.symbol().catch(() => 'TOKEN'),
    token.decimals().catch(() => 18),
  ])

  const decimals = Number(tokenDecimals)
  const amountIn =
    direction === 'buy'
      ? parseEtherAmount(amount, text.invalidAmount)
      : parseTokenAmount(amount, decimals, text.invalidAmount)
  const path = buildSwapPath(normalizedToken, direction)

  let amounts: bigint[]
  try {
    amounts = (await router.getAmountsOut(amountIn, path)) as bigint[]
  } catch {
    throw new Error(text.quoteFailed)
  }

  const amountOut = BigInt(amounts[amounts.length - 1] ?? 0n)
  if (amountOut <= 0n) {
    throw new Error(text.quoteFailed)
  }

  const minimumAmountOut = (amountOut * BigInt(10_000 - normalizedSlippage)) / 10_000n
  const allowance =
    direction === 'sell' && account && isAddress(account)
      ? BigInt(await token.allowance(account, PANCAKE_V2_ROUTER_ADDRESS).catch(() => 0n))
      : 0n

  return {
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    minimumAmountOut: minimumAmountOut.toString(),
    formattedAmountOut:
      direction === 'buy'
        ? formatTokenAmount(amountOut, decimals)
        : `${formatEther(amountOut)} BNB`,
    formattedMinimumAmountOut:
      direction === 'buy'
        ? formatTokenAmount(minimumAmountOut, decimals)
        : `${formatEther(minimumAmountOut)} BNB`,
    needsApproval: direction === 'sell' && allowance < amountIn,
    routeLabel:
      direction === 'buy'
        ? `BNB -> ${String(tokenSymbol)}`
        : `${String(tokenSymbol)} -> BNB`,
    sourceSymbol: direction === 'buy' ? 'BNB' : String(tokenSymbol),
    targetSymbol: direction === 'buy' ? String(tokenSymbol) : 'BNB',
    tokenSymbol: String(tokenSymbol),
    tokenDecimals: decimals,
  }
}

export async function approvePancakeSwapToken(
  provider: EthereumProvider,
  tokenAddress: string,
  amountIn: string,
  locale: PancakeLocale = 'zh',
): Promise<PancakeTransactionResult> {
  const from = await prepareWallet(provider, locale)
  const normalizedToken = normalizeTokenAddress(tokenAddress, locale)
  const amount = BigInt(amountIn || '0')
  if (amount <= 0n) {
    throw new Error(messages[locale].invalidAmount)
  }

  const iface = new Interface(erc20WriteAbi)
  const data = iface.encodeFunctionData('approve', [PANCAKE_V2_ROUTER_ADDRESS, amount])
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: normalizedToken,
        data,
      },
    ],
  })) as string

  return { hash }
}

export async function executePancakeSwap(
  provider: EthereumProvider,
  request: PancakeSwapRequest,
): Promise<PancakeTransactionResult> {
  const locale = request.locale ?? 'zh'
  const from = await prepareWallet(provider, locale)
  const quote = await fetchPancakeSwapQuote({ ...request, account: from, locale })
  const iface = new Interface(routerAbi)
  const path = buildSwapPath(request.tokenAddress, request.direction)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60)
  const amountIn = BigInt(quote.amountIn)
  const minimumAmountOut = BigInt(quote.minimumAmountOut)

  const data =
    request.direction === 'buy'
      ? iface.encodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', [
          minimumAmountOut,
          path,
          from,
          deadline,
        ])
      : iface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', [
          amountIn,
          minimumAmountOut,
          path,
          from,
          deadline,
        ])

  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: PANCAKE_V2_ROUTER_ADDRESS,
        value: request.direction === 'buy' ? toQuantity(amountIn) : '0x0',
        data,
      },
    ],
  })) as string

  return { hash, quote }
}

export function buildPancakeSwapUrl(tokenAddress: string, direction: PancakeSwapDirection) {
  if (!isAddress(tokenAddress)) {
    return 'https://pancakeswap.finance/swap?chain=bsc'
  }

  const key = direction === 'buy' ? 'outputCurrency' : 'inputCurrency'
  return `https://pancakeswap.finance/swap?chain=bsc&${key}=${tokenAddress}`
}

function buildSwapPath(tokenAddress: string, direction: PancakeSwapDirection) {
  const token = normalizeTokenAddress(tokenAddress, 'zh')
  return direction === 'buy' ? [WBNB_ADDRESS, token] : [token, WBNB_ADDRESS]
}

async function prepareWallet(provider: EthereumProvider, locale: PancakeLocale) {
  const text = messages[locale]
  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== 56) {
    throw new Error(text.wrongNetwork)
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(text.connectWallet)
  }

  return from
}

function normalizeTokenAddress(tokenAddress: string, locale: PancakeLocale) {
  const normalizedToken = tokenAddress.trim()
  if (!isAddress(normalizedToken) || normalizedToken.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
    throw new Error(messages[locale].invalidToken)
  }

  return normalizedToken
}

function normalizeSlippage(slippageBps: number, locale: PancakeLocale) {
  if (!Number.isFinite(slippageBps) || slippageBps <= 0 || slippageBps > 5_000) {
    throw new Error(messages[locale].invalidSlippage)
  }

  return Math.round(slippageBps)
}

function parseEtherAmount(value: string, errorMessage: string) {
  try {
    const parsed = parseEther(value || '0')
    if (parsed <= 0n) {
      throw new Error(errorMessage)
    }
    return parsed
  } catch {
    throw new Error(errorMessage)
  }
}

function parseTokenAmount(value: string, decimals: number, errorMessage: string) {
  try {
    const parsed = parseUnits(value || '0', decimals)
    if (parsed <= 0n) {
      throw new Error(errorMessage)
    }
    return parsed
  } catch {
    throw new Error(errorMessage)
  }
}

function formatTokenAmount(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals)
  const [integer, fraction = ''] = formatted.split('.')
  const compactFraction = fraction.slice(0, 6).replace(/0+$/, '')

  return compactFraction ? `${integer}.${compactFraction}` : integer
}
