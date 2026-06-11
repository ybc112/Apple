import type { AllocationKey, AllocationState, FormState, LaunchTemplate } from './types'

export const BNB_CHAIN = {
  chainId: '0x38',
  chainName: 'BNB Smart Chain',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: ['https://bsc.publicnode.com'],
  blockExplorerUrls: ['https://bscscan.com'],
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'

export const initialForm: FormState = {
  tokenName: 'Apple',
  symbol: 'APPLE',
  description:
    'Apple Seed Launch：面向社区的链上发射实验，独立代币、独立金库、公开 mint，关键参数全部写入链上。',
  supply: '1000000000',
  mintCount: '2000',
  publicMintCount: '1800',
  whitelistMintCount: '200',
  mintPrice: '0.003',
  paymentToken: ZERO_ADDRESS,
  rewardToken: '',
  rewardThreshold: '1',
  receiverWallet: '',
  telegram: '',
  xLink: '',
  website: '',
}

export const initialAllocation: AllocationState = {
  marketing: 44,
  liquidity: 18,
  rewards: 16,
  burn: 10,
}

export const templates: LaunchTemplate[] = [
  {
    id: 'standard',
    name: 'Seed Mint',
    tag: 'Core',
    fee: '0.005 BNB',
    summary: '创建独立 ERC20 和独立 Vault，用户按次数公开 mint，适合快速启动社区资产。',
    bestFor: '社区首发、活动票券、轻量资产发行',
    checks: ['固定发行量', '公开 mint 次数', '独立 Vault', '创建者接收钱包'],
  },
  {
    id: 'time',
    name: 'Timed Orchard',
    tag: 'Time',
    fee: '0.005 BNB',
    summary: '为预热、排队和分批开放保留参数入口，方便后续扩展白名单和开盘时间。',
    bestFor: '预热活动、排队发射、分批开放',
    checks: ['开放时间', '冷却窗口', '进度追踪', '公开参数'],
  },
  {
    id: 'buyback',
    name: 'Buyback Core',
    tag: 'Flow',
    fee: '0.005 BNB',
    summary: '税收拆分可映射到基金、回流、奖励和销毁，适合长期运营型项目。',
    bestFor: '交易税玩法、持续运营、回购叙事',
    checks: ['买卖税', '基金分配', '销毁比例', '接收钱包'],
  },
  {
    id: 'nftReward',
    name: 'Reward Grove',
    tag: 'Reward',
    fee: '0.005 BNB',
    summary: '记录奖励代币和持仓门槛，便于后续扩展 NFT、任务或会员奖励。',
    bestFor: '任务制社区、持仓奖励、游戏化发行',
    checks: ['奖励代币', '门槛记录', '模板 ID', '后续升级'],
  },
]

export const allocationMeta: Array<{
  key: AllocationKey
  label: string
  hint: string
  color: string
}> = [
  {
    key: 'burn',
    label: '销毁',
    hint: '减少供应',
    color: '#ff8a9a',
  },
  {
    key: 'marketing',
    label: '营销',
    hint: '进入接收钱包',
    color: '#9bf6c2',
  },
  {
    key: 'liquidity',
    label: '回流',
    hint: 'LP 进入黑洞',
    color: '#7dd3fc',
  },
  {
    key: 'rewards',
    label: '持币分红',
    hint: '进入分红池',
    color: '#b8c7ff',
  },
]

export const auditorQueue = [
  { project: 'Seed Mint', owner: '0x71b8...55a1', score: 92, state: '通过' },
  { project: 'Orchard Core', owner: '0xa329...09d5', score: 78, state: '复核中' },
  { project: 'Apple Vault', owner: '0x469e...78ff', score: 86, state: '待签名' },
]

export const paymentTokens = [
  {
    label: 'BNB',
    symbol: 'BNB',
    address: ZERO_ADDRESS,
    note: '原生 BNB mint',
  },
  {
    label: 'USDT',
    symbol: 'USDT',
    address: USDT_ADDRESS,
    note: 'BSC USDT',
  },
]
