import { Contract, Interface, JsonRpcProvider, isAddress } from 'ethers'
import { BNB_CHAIN } from '../data'
import type { EthereumProvider } from '../wallet'
import { DEFAULT_AUDIT_REGISTRY_ADDRESS, launchpadConfig } from './launchpad'

export type AuditLocale = 'zh' | 'en'
export type AuditorStatus = 0 | 1 | 2
export type RiskLevel = 0 | 1 | 2 | 3

export type AuditorProfile = {
  status: AuditorStatus
  profileUri: string
  appliedAt: number
  approvedAt: number
  reviewCount: string
}

export type AuditReview = {
  auditor: string
  projectToken: string
  score: number
  riskLevel: RiskLevel
  reportUri: string
  updatedAt: number
}

export type AuditDashboard = {
  owner: string
  profile: AuditorProfile
  recentReviews: AuditReview[]
}

export type AuditTransactionResult = {
  hash: string
}

export const auditRegistryConfig = {
  chainId: Number(import.meta.env.VITE_LAUNCHPAD_CHAIN_ID ?? 56),
  registryAddress: String(import.meta.env.VITE_AUDIT_REGISTRY_ADDRESS || DEFAULT_AUDIT_REGISTRY_ADDRESS),
}

export const isAuditRegistryConfigured =
  Boolean(auditRegistryConfig.registryAddress) && isAddress(auditRegistryConfig.registryAddress)

export const auditRegistryAbi = [
  'function owner() view returns (address)',
  'function applyAuditor(string profileUri)',
  'function setAuditorStatus(address auditor,uint8 status)',
  'function submitReview(address projectToken,uint8 score,uint8 riskLevel,string reportUri)',
  'function auditors(address) view returns (uint8 status,string profileUri,uint64 appliedAt,uint64 approvedAt,uint64 reviewCount)',
  'function allReviewedProjectsLength() view returns (uint256)',
  'function allReviewedProjects(uint256) view returns (address)',
  'function getProjectReviews(address projectToken) view returns ((address auditor,address projectToken,uint8 score,uint8 riskLevel,string reportUri,uint64 updatedAt)[])',
] as const

const messages = {
  zh: {
    notConfigured: '审核 Registry 地址无效：前端源码已内置当前 Registry 地址，请检查默认地址或覆盖配置。',
    wrongNetwork: '当前钱包网络不是 BNB Smart Chain，请先切换网络。',
    connectWallet: '请先连接钱包。',
    invalidProfile: '请填写审核员资料链接或简介 URI。',
    invalidAuditor: '请填写有效的审核员钱包。',
    invalidProject: '请填写有效的项目代币合约地址。',
    invalidScore: '评分必须是 0 到 100 的数字。',
    invalidReport: '请填写审核报告链接或报告 URI。',
  },
  en: {
    notConfigured: 'Audit Registry address is invalid. The current Registry address is built into the frontend source; check the default address or override config.',
    wrongNetwork: 'The connected wallet is not on BNB Smart Chain. Please switch networks first.',
    connectWallet: 'Please connect your wallet first.',
    invalidProfile: 'Enter an auditor profile link or profile URI.',
    invalidAuditor: 'Enter a valid auditor wallet.',
    invalidProject: 'Enter a valid project token contract address.',
    invalidScore: 'Score must be a number from 0 to 100.',
    invalidReport: 'Enter an audit report link or report URI.',
  },
} as const

const emptyProfile: AuditorProfile = {
  status: 0,
  profileUri: '',
  appliedAt: 0,
  approvedAt: 0,
  reviewCount: '0',
}

export async function fetchAuditDashboard(account = ''): Promise<AuditDashboard> {
  if (!isAuditRegistryConfigured) {
    return {
      owner: '',
      profile: emptyProfile,
      recentReviews: [],
    }
  }

  const provider = new JsonRpcProvider(BNB_CHAIN.rpcUrls[0], launchpadConfig.chainId)
  const registry = new Contract(auditRegistryConfig.registryAddress, auditRegistryAbi, provider)
  const [owner, profile, recentReviews] = await Promise.all([
    registry.owner().catch(() => ''),
    account && isAddress(account) ? registry.auditors(account).catch(() => null) : null,
    fetchRecentReviews(registry),
  ])

  return {
    owner: String(owner),
    profile: profile ? mapProfile(profile) : emptyProfile,
    recentReviews,
  }
}

export async function applyForAuditor(
  provider: EthereumProvider,
  profileUri: string,
  locale: AuditLocale = 'zh',
): Promise<AuditTransactionResult> {
  const text = messages[locale]
  ensureConfigured(locale)
  const from = await readActiveAccount(provider, locale)
  await ensureTargetNetwork(provider, locale)

  if (!profileUri.trim()) {
    throw new Error(text.invalidProfile)
  }

  const iface = new Interface(auditRegistryAbi)
  const data = iface.encodeFunctionData('applyAuditor', [profileUri.trim()])

  return sendTransaction(provider, from, data)
}

export async function setAuditorStatus(
  provider: EthereumProvider,
  auditor: string,
  status: AuditorStatus,
  locale: AuditLocale = 'zh',
): Promise<AuditTransactionResult> {
  const text = messages[locale]
  ensureConfigured(locale)
  const from = await readActiveAccount(provider, locale)
  await ensureTargetNetwork(provider, locale)

  if (!isAddress(auditor)) {
    throw new Error(text.invalidAuditor)
  }

  const iface = new Interface(auditRegistryAbi)
  const data = iface.encodeFunctionData('setAuditorStatus', [auditor, status])

  return sendTransaction(provider, from, data)
}

export async function submitAuditReview(
  provider: EthereumProvider,
  projectToken: string,
  score: string,
  riskLevel: RiskLevel,
  reportUri: string,
  locale: AuditLocale = 'zh',
): Promise<AuditTransactionResult> {
  const text = messages[locale]
  ensureConfigured(locale)
  const from = await readActiveAccount(provider, locale)
  await ensureTargetNetwork(provider, locale)

  const scoreValue = Number(score)
  if (!isAddress(projectToken)) {
    throw new Error(text.invalidProject)
  }
  if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 100) {
    throw new Error(text.invalidScore)
  }
  if (!reportUri.trim()) {
    throw new Error(text.invalidReport)
  }

  const iface = new Interface(auditRegistryAbi)
  const data = iface.encodeFunctionData('submitReview', [
    projectToken,
    Math.round(scoreValue),
    riskLevel,
    reportUri.trim(),
  ])

  return sendTransaction(provider, from, data)
}

async function fetchRecentReviews(registry: Contract) {
  const count = Number(await registry.allReviewedProjectsLength().catch(() => 0n))
  const start = Math.max(0, count - 8)
  const reviews: AuditReview[] = []

  for (let index = count - 1; index >= start; index -= 1) {
    const projectToken = String(await registry.allReviewedProjects(index))
    const projectReviews = (await registry.getProjectReviews(projectToken).catch(() => [])) as Array<
      Parameters<typeof mapReview>[0]
    >
    reviews.push(...projectReviews.map((review) => mapReview(review)))
  }

  return reviews
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 12)
}

function mapProfile(profile: {
  status?: bigint | number
  profileUri?: string
  appliedAt?: bigint | number
  approvedAt?: bigint | number
  reviewCount?: bigint | number
  [index: number]: unknown
}): AuditorProfile {
  return {
    status: Number(profile.status ?? profile[0] ?? 0) as AuditorStatus,
    profileUri: String(profile.profileUri ?? profile[1] ?? ''),
    appliedAt: Number(profile.appliedAt ?? profile[2] ?? 0),
    approvedAt: Number(profile.approvedAt ?? profile[3] ?? 0),
    reviewCount: String(profile.reviewCount ?? profile[4] ?? 0),
  }
}

function mapReview(review: {
  auditor?: string
  projectToken?: string
  score?: bigint | number
  riskLevel?: bigint | number
  reportUri?: string
  updatedAt?: bigint | number
  [index: number]: unknown
}): AuditReview {
  return {
    auditor: String(review.auditor ?? review[0] ?? ''),
    projectToken: String(review.projectToken ?? review[1] ?? ''),
    score: Number(review.score ?? review[2] ?? 0),
    riskLevel: Number(review.riskLevel ?? review[3] ?? 0) as RiskLevel,
    reportUri: String(review.reportUri ?? review[4] ?? ''),
    updatedAt: Number(review.updatedAt ?? review[5] ?? 0),
  }
}

function ensureConfigured(locale: AuditLocale) {
  if (!isAuditRegistryConfigured) {
    throw new Error(messages[locale].notConfigured)
  }
}

async function ensureTargetNetwork(provider: EthereumProvider, locale: AuditLocale) {
  const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (Number.parseInt(chainId, 16) !== auditRegistryConfig.chainId) {
    throw new Error(messages[locale].wrongNetwork)
  }
}

async function readActiveAccount(provider: EthereumProvider, locale: AuditLocale) {
  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  const from = accounts[0]
  if (!from || !isAddress(from)) {
    throw new Error(messages[locale].connectWallet)
  }

  return from
}

async function sendTransaction(provider: EthereumProvider, from: string, data: string) {
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: auditRegistryConfig.registryAddress,
        value: '0x0',
        data,
      },
    ],
  })) as string

  return { hash }
}
