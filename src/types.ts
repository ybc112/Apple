import type { ReactNode } from 'react'

export type PageKey = 'home' | 'launch' | 'templates' | 'swap' | 'auditors' | 'verify' | 'detail'

export type TemplateId =
  | 'standard'
  | 'time'
  | 'buyback'
  | 'lp'
  | 'holdLpBurn'
  | 'burnOut'
  | 'moduleLimit'
  | 'nftReward'

export type DeployState = 'draft' | 'wallet' | 'network' | 'ready' | 'pending' | 'blocked' | 'sent'

export type FormState = {
  tokenName: string
  symbol: string
  description: string
  supply: string
  mintCount: string
  publicMintCount: string
  whitelistMintCount: string
  mintPrice: string
  paymentToken: string
  rewardToken: string
  rewardThreshold: string
  receiverWallet: string
  telegram: string
  xLink: string
  website: string
}

export type AllocationKey = 'marketing' | 'liquidity' | 'rewards' | 'burn'

export type AllocationState = Record<AllocationKey, number>

export type LaunchTemplate = {
  id: TemplateId
  name: string
  tag: string
  fee: string
  summary: string
  bestFor: string
  checks: string[]
}

export type LaunchDraft = {
  form: FormState
  allocation: AllocationState
  buyTax: number
  sellTax: number
  templateId: TemplateId
  avatar: string
  whitelistEnabled: boolean
}

export type LaunchProject = {
  creator: string
  token: string
  vault: string
  paymentToken: string
  receiver: string
  name: string
  symbol: string
  description: string
  website: string
  telegram: string
  xLink: string
  totalSupply: string
  mintCount: string
  mintPrice: string
  mintedCount: string
  publicMintCount: string
  whitelistMintCount: string
  publicMintedCount: string
  whitelistMintedCount: string
  progress: number
  whitelistEnabled: boolean
  createdAt: number
}

export type NavItem = {
  page: PageKey
  label: string
  icon: ReactNode
}

export type WalletState = {
  account: string
  chainId: string
  status: 'idle' | 'connecting' | 'connected' | 'missing' | 'error'
  error: string
}
