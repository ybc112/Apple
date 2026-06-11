import {
  AlertCircle,
  ArrowUpDown,
  AtSign,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  FileCode2,
  Globe2,
  Home,
  Languages,
  Menu,
  MessageCircle,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  BNB_CHAIN,
  USDT_ADDRESS,
  allocationMeta,
  initialAllocation,
  initialForm,
  paymentTokens,
  templates,
} from './data'
import {
  approveProjectRefundTokens,
  approveProjectMintPayment,
  claimProjectRefund,
  createLaunchToken,
  fetchLaunchProjects,
  isLaunchpadConfigured,
  launchpadConfig,
  mintLaunchProject,
  setProjectWhitelistAllowance,
  waitForTransactionReceipt,
} from './contracts/launchpad'
import {
  PANCAKE_V2_ROUTER_ADDRESS,
  approvePancakeSwapToken,
  buildPancakeSwapUrl,
  executePancakeSwap,
  fetchPancakeSwapQuote,
  type PancakeSwapDirection,
  type PancakeSwapQuote,
  type PancakeSwapRequest,
} from './contracts/pancake'
import {
  applyForAuditor,
  fetchAuditDashboard,
  isAuditRegistryConfigured,
  setAuditorStatus,
  submitAuditReview,
  type AuditDashboard,
  type AuditorStatus,
  type RiskLevel,
} from './contracts/audit'
import type {
  AllocationKey,
  AllocationState,
  DeployState,
  FormState,
  LaunchProject,
  LaunchTemplate,
  PageKey,
  TemplateId,
  WalletState,
} from './types'
import {
  getAccounts,
  getChainId,
  getProvider,
  readProviderErrorMessage,
  requestAccounts,
  shortAddress,
  switchToBnbChain,
  targetChainId,
} from './wallet'

const pages: PageKey[] = ['home', 'launch', 'auditors', 'verify', 'swap', 'detail']
const appName = String(import.meta.env.VITE_APP_NAME ?? 'Apple')
const appSymbol = String(import.meta.env.VITE_APP_SYMBOL ?? 'APPLE')
const factoryExplorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${launchpadConfig.factoryAddress}#code`

type Language = 'zh' | 'en'

type Notice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

type ProjectsStatus = 'idle' | 'loading' | 'ready' | 'error'
type ProjectFilter = 'all' | 'minting' | 'whitelist' | 'completed'

const defaultDescriptions: Record<Language, string> = {
  zh: initialForm.description,
  en:
    'Apple Seed Launch: an on-chain launch experiment for communities, with an independent token, mint vault, public minting, and key parameters recorded on-chain.',
}

const copy = {
  zh: {
    language: '中文',
    menuOpen: '展开菜单',
    menuClose: '收起菜单',
    mainNav: '主导航',
    optional: '可选',
    wallet: {
      connect: '连接钱包',
      connecting: '连接中',
      missing: '未检测到浏览器钱包，请安装 MetaMask、OKX Wallet 或 TokenPocket。',
      missingShort: '未检测到浏览器钱包。',
      noAccount: '钱包没有返回可用账号。',
      noProviderForTx: '未检测到浏览器钱包，无法提交链上交易。',
    },
    nav: {
      home: '返回首页',
      auditors: '审核员',
      verify: '合约开源',
      swap: '交易所',
      launch: '部署代币',
    },
    notice: {
      confirmDeploy: '请在钱包里确认部署交易，部署费为 0.005 BNB。',
      txSubmitted: (hash: string) => `部署交易已提交：${hash}，正在等待链上确认。`,
      txConfirmed: '交易已确认，项目已经写入链上列表。',
      confirmWhitelist: '请在钱包里确认白名单额度交易。',
      whitelistSubmitted: (hash: string) => `白名单交易已提交：${hash}，正在等待链上确认。`,
      whitelistConfirmed: '白名单额度已写入链上。',
      confirmMintApproval: '请先在钱包里授权付款代币给 Vault。',
      mintApprovalSubmitted: (hash: string) => `Mint 授权已提交：${hash}，正在等待链上确认。`,
      mintApprovalConfirmed: 'Mint 授权已确认，继续提交 mint 交易。',
      confirmMint: '请在钱包里确认 mint 交易。',
      mintSubmitted: (hash: string) => `Mint 交易已提交：${hash}，正在等待链上确认。`,
      mintConfirmed: 'Mint 已完成，项目进度已刷新。',
      confirmRefundApproval: '请先在钱包里授权 Vault 取回你的发射代币。',
      refundApprovalSubmitted: (hash: string) => `退款授权已提交：${hash}，正在等待链上确认。`,
      refundApprovalConfirmed: '退款授权已确认，继续提交退款交易。',
      confirmRefund: '请在钱包里确认退款交易。退款会把你的代币退回 Vault，再退回付款。',
      refundSubmitted: (hash: string) => `退款交易已提交：${hash}，正在等待链上确认。`,
      refundConfirmed: '退款已完成。',
      confirmSwapApproval: '请在钱包里授权 PancakeSwap Router 使用你的代币。',
      swapApprovalSubmitted: (hash: string) => `Swap 授权已提交：${hash}，正在等待链上确认。`,
      swapApprovalConfirmed: 'Swap 授权已确认。',
      confirmSwap: '请在钱包里确认 PancakeSwap 兑换交易。',
      swapSubmitted: (hash: string) => `Swap 交易已提交：${hash}，正在等待链上确认。`,
      swapConfirmed: 'Swap 交易已确认。',
      confirmAuditorApply: '请在钱包里确认审核员申请交易。',
      auditorApplySubmitted: (hash: string) => `审核员申请已提交：${hash}，正在等待链上确认。`,
      auditorApplyConfirmed: '审核员申请已写入链上，等待管理员批准。',
      confirmAuditorStatus: '请在钱包里确认审核员状态交易。',
      auditorStatusSubmitted: (hash: string) => `审核员状态交易已提交：${hash}，正在等待链上确认。`,
      auditorStatusConfirmed: '审核员状态已更新。',
      confirmAuditReview: '请在钱包里确认项目审核交易。',
      auditReviewSubmitted: (hash: string) => `项目审核已提交：${hash}，正在等待链上确认。`,
      auditReviewConfirmed: '项目审核记录已写入链上。',
    },
    home: {
      eyebrow: `${appName} Seed Protocol`,
      title: '把社区资产发射成一个完整品牌',
      subtitle:
        '创建独立 ERC20 和独立 Vault，配置 mint、税收、奖励和接收钱包。每一次发射都会写入链上，确认后自动出现在项目列表。',
      launch: '部署代币',
      openAuditors: '审核员入口',
      consoleAria: '发射流程预览',
      consoleStats: [
        ['代币', appSymbol, '1,000,000,000'],
        ['铸造', '2,000', '0.003 BNB'],
        ['税费', '3 / 3', '营销 + 销毁'],
        ['模式', 'Seed', '白名单可用'],
      ],
      consoleFlow: ['钱包', '工厂合约', '代币 + 金库'],
      features: [
        ['01 发射', '0.005 BNB 创建合约', '连接钱包后直接发送真实部署交易；Factory 已部署并开源，项目发布后会进入链上列表。'],
        ['02 玩法', 'Mint + Vault 独立运行', '每个项目拥有独立 ERC20 和独立铸造金库，用户 mint 后立即获得真实代币余额。'],
        ['03 风控', '白名单和税收上链', '买卖税、营销、回流、持币分红、销毁和白名单模式随项目创建写入链上。'],
      ],
    },
    projects: {
      search: '输入代币名称、符号或合约地址搜索',
      tabs: {
        all: '链上项目',
        minting: '铸造中',
        whitelist: '白名单',
        completed: '已完成',
      },
      emptyTitle: '暂无可展示项目',
      notConfiguredTitle: 'Factory 还未配置',
      readErrorTitle: '链上项目读取失败',
      firstAction: '发布第一个项目',
      deployAction: '去部署项目',
      loading: '项目加载中',
      progress: '铸造进度',
      statusMinting: '铸造中',
      statusTrading: '已开盘',
      statusCompleted: '已完成',
      statusWhitelist: '白名单',
      viewBscScan: '在 BscScan 查看',
      copyAddress: '复制合约',
      copied: '已复制',
      detail: '查看机制',
      trade: '去交易',
      website: '官网',
      fallbackDescription: `${appName} 链上发射项目`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `白名单 ${whitelistMinted}/${whitelistTotal} · 公开 ${publicMinted}/${publicTotal}`,
      whitelistManage: '添加白名单',
      whitelistAddress: '白名单钱包地址',
      whitelistAllowance: '可 mint 次数',
      whitelistSubmit: '保存额度',
      whitelistPending: '等待确认',
      mint: 'Mint',
      mintQuantity: 'Mint 数量',
      mintCost: (amount: string) => `合计 ${amount}`,
      approveMint: '授权付款',
      whitelistRemaining: (amount: string) => `白名单可用 ${amount}`,
      mintClosed: '已结束',
      refund: '申请退款',
      refundAvailable: (amount: string) => `可退款 ${amount}`,
      refundTip: '24 小时未打满后可退款',
    },
    detail: {
      eyebrow: '项目详情',
      title: (name: string) => `${name} 详情`,
      loading: '正在读取链上项目详情',
      missingTitle: '没有找到这个项目',
      missingDesc: '项目可能还在确认中，或者当前 Factory 列表里暂时没有这个 Token。',
      back: '返回项目列表',
      mechanism: '代币机制',
      taxMechanism: '税费机制',
      rewardBadge: (address: string) => `分红 ${shortAddress(address)}`,
      contractBalance: '合约余额',
      vaultBalanceHint: 'Vault 未铸造余额',
      buyTax: '买入税',
      sellTax: '卖出税',
      marketing: '营销分配',
      liquidity: '回流分配',
      rewards: '持币分红',
      burn: '销毁分配',
      platformFee: '平台服务费',
      rewardThreshold: '分红门槛',
      receiver: '接收钱包',
      vault: 'Vault 地址',
      token: 'Token 合约',
      whitelist: '白名单',
      mintProgress: '铸造进度',
      supply: '发行总量',
      tradingState: '权限状态',
      tradingFinalized: '已开盘，Token 与 Vault 权限已进入黑洞',
      tradingPending: '内盘阶段，打满后自动开盘并丢权限',
      enabled: '开启',
      disabled: '关闭',
      unallocated: '未分配',
      toReceiver: (address: string) => `进入 ${shortAddress(address)}`,
      toPlatform: () => '进入平台服务费',
      toBlackHole: '进入黑洞',
      toRewardToken: (address: string) => `指定代币 ${shortAddress(address)}`,
      toBurn: '直接销毁',
      taxPortionPair: (buy: string, sell: string) => (buy === sell ? buy : `买入 ${buy} / 卖出 ${sell}`),
      copyToken: '复制 Token',
      copyVault: '复制 Vault',
      openExplorer: '查看 BscScan',
      trade: '去交易',
      noTax: '无税费',
      tokenUnit: (symbol: string) => symbol,
    },
    swap: {
      title: 'PancakeSwap 交易',
      desc: '通过 PancakeSwap V2 Router 直接兑换，成交取决于项目是否已经添加 BNB 流动性。',
      selectProject: '选择项目',
      customToken: '自定义代币',
      tokenAddress: '代币合约地址',
      amount: '数量',
      slippage: '滑点',
      buy: '买入',
      sell: '卖出',
      quote: '获取报价',
      refresh: '刷新报价',
      approve: '授权代币',
      swap: '确认兑换',
      pending: '等待确认',
      route: '路由',
      expected: '预计得到',
      minimum: '最低收到',
      router: '薄饼 Router',
      noProjects: '暂无已开盘项目，可以手动输入已加 LP 的代币合约。',
      quoteHint: '报价来自 PancakeSwap，含税代币实际到账可能低于显示值。',
      openPancake: '打开薄饼',
    },
    launch: {
      network: '当前网络',
      waitingNetwork: '等待切换到 BNB Smart Chain',
      walletHint: '连接钱包后会自动填入创建者接收地址',
      switchNetwork: '切换网络',
      factoryUnset: '未配置',
      section01: '01 基础信息',
      title: '部署你的发射代币',
      intro: '填写品牌名称、符号、简介、付款代币、mint 价格和项目接收钱包。',
      feeBadge: '部署费 0.005 BNB',
      tokenName: '代币名称',
      tokenSymbol: '代币符号',
      description: '项目介绍',
      section02: '02 模板',
      templateTitle: '选择合约模板',
      section03: '03 铸造参数',
      mintTitle: 'Mint 价格与供应',
      supply: '发行总量',
      mintCount: '总铸造次数',
      publicMintCount: '公开份数',
      whitelistMintCount: '白名单份数',
      mintPrice: '单次价格',
      whitelistTitle: '开启白名单 Mint',
      whitelistDesc: '开启后，只有项目方在 Vault 里设置过额度的钱包可以 mint。',
      section04: '04 税收分配',
      taxTitle: '买卖税与四项分配',
      total: (value: number) => `总计 ${value}%`,
      buyTax: '买入税',
      sellTax: '卖出税',
      unallocated: (value: number) => `未分配 ${value}%`,
      allocationOverflow: '分配总和超过 100%，合约会拒绝部署。',
      section05: '05 链上配置',
      receiverTitle: '接收与分红',
      onchain: '链上记录',
      receiverWallet: '接收钱包',
      rewardToken: '分红代币地址',
      rewardTokenPlaceholder: '留空默认 USDT',
      rewardTokenDefault: `默认 USDT：${shortAddress(USDT_ADDRESS)}`,
      rewardThreshold: '持仓门槛',
      section06: '06 可选链接',
      linksTitle: '社区入口',
      linksDesc: 'Telegram、X 和官网会随项目简介一起保存，留空不会影响部署。',
      telegram: 'Telegram 链接',
      x: 'X 链接',
      website: '官网链接',
      configWarning:
        '真实交易已经接好，但还没有配置 Factory 地址。部署合约后把地址写入 VITE_LAUNCHPAD_FACTORY_ADDRESS。',
      pending: '等待钱包确认',
      submit: '部署并进入链上列表',
      currentTemplate: '当前模板',
      mode: '品牌发射模式',
      preview: '交易预览',
      deployFee: '部署费',
      paymentToken: '付款代币',
      mintQuota: '铸造份数',
      whitelist: '白名单',
      enabled: '开启',
      disabled: '关闭',
      taxRate: '税率',
      totalAllocation: '总分配',
      factory: '工厂',
    },
    auditors: {
      title: '链上审核员',
      desc: '审核员申请、平台批准、项目评分和报告链接都会写入 Audit Registry，用户可以直接查链上记录。',
      configWarning: '审核 Registry 未配置：部署 AppleAuditRegistry 后，把地址写入 VITE_AUDIT_REGISTRY_ADDRESS。',
      registry: '审核 Registry',
      connect: '连接钱包',
      statusTitle: '我的审核员状态',
      statusLabels: ['未申请', '待审核', '已批准'],
      statusHelp: ['还没有提交链上申请。', '申请已上链，等待管理员批准。', '可以提交项目审核报告。'],
      profileTitle: '申请成为审核员',
      profileDesc: '资料链接可以是 IPFS、官网、GitHub、Notion 或历史报告页。',
      profileUri: '资料链接 / Profile URI',
      apply: '提交申请',
      reviewTitle: '提交项目审核',
      reviewDesc: '只有已批准审核员可以提交，重复提交同一项目会更新原记录。',
      projectToken: '项目代币合约',
      score: '评分 0-100',
      risk: '风险等级',
      riskLabels: ['低风险', '中风险', '高风险', '严重风险'],
      reportUri: '报告链接 / Report URI',
      submitReview: '提交链上审核',
      pending: '等待确认',
      adminTitle: '管理员审批',
      adminDesc: '只有 Registry owner 钱包可以批准审核员；审核员只负责提交报告，不控制开盘。',
      auditorWallet: '审核员钱包',
      approve: '批准',
      ownerOnly: '连接 Registry owner 钱包后可审批审核员。',
      recentTitle: '最近审核记录',
      emptyReviews: '暂无链上审核记录。',
      openReport: '打开报告',
      owner: 'Registry 管理员',
    },
    verify: {
      title: '工厂合约已开源',
      subtitle: '当前发射工厂已在 BscScan 完成源码验证，用户可以直接检查构造参数和合约代码。',
      button: '查看 BscScan',
    },
  },
  en: {
    language: 'English',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
    mainNav: 'Main navigation',
    optional: 'Optional',
    wallet: {
      connect: 'Connect wallet',
      connecting: 'Connecting',
      missing: 'No browser wallet found. Please install MetaMask, OKX Wallet, or TokenPocket.',
      missingShort: 'No browser wallet found.',
      noAccount: 'The wallet did not return an available account.',
      noProviderForTx: 'No browser wallet found, so the on-chain transaction cannot be submitted.',
    },
    nav: {
      home: 'Home',
      auditors: 'Auditors',
      verify: 'Verified',
      swap: 'Swap',
      launch: 'Launch token',
    },
    notice: {
      confirmDeploy: 'Confirm the deployment transaction in your wallet. The launch fee is 0.005 BNB.',
      txSubmitted: (hash: string) => `Deployment transaction submitted: ${hash}. Waiting for confirmation.`,
      txConfirmed: 'Transaction confirmed. The project is now recorded in the on-chain list.',
      confirmWhitelist: 'Confirm the whitelist allowance transaction in your wallet.',
      whitelistSubmitted: (hash: string) => `Whitelist transaction submitted: ${hash}. Waiting for confirmation.`,
      whitelistConfirmed: 'Whitelist allowance is now recorded on-chain.',
      confirmMintApproval: 'Approve the payment token for the Vault first.',
      mintApprovalSubmitted: (hash: string) => `Mint approval submitted: ${hash}. Waiting for confirmation.`,
      mintApprovalConfirmed: 'Mint approval confirmed. Continue with the mint transaction.',
      confirmMint: 'Confirm the mint transaction in your wallet.',
      mintSubmitted: (hash: string) => `Mint transaction submitted: ${hash}. Waiting for confirmation.`,
      mintConfirmed: 'Mint complete. Project progress refreshed.',
      confirmRefundApproval: 'First approve the Vault to take back your launch tokens.',
      refundApprovalSubmitted: (hash: string) => `Refund approval submitted: ${hash}. Waiting for confirmation.`,
      refundApprovalConfirmed: 'Refund approval confirmed. Continue with the refund transaction.',
      confirmRefund: 'Confirm the refund transaction. Your tokens will be returned to the Vault before payment is refunded.',
      refundSubmitted: (hash: string) => `Refund transaction submitted: ${hash}. Waiting for confirmation.`,
      refundConfirmed: 'Refund complete.',
      confirmSwapApproval: 'Approve the PancakeSwap Router to use your tokens.',
      swapApprovalSubmitted: (hash: string) => `Swap approval submitted: ${hash}. Waiting for confirmation.`,
      swapApprovalConfirmed: 'Swap approval confirmed.',
      confirmSwap: 'Confirm the PancakeSwap transaction in your wallet.',
      swapSubmitted: (hash: string) => `Swap transaction submitted: ${hash}. Waiting for confirmation.`,
      swapConfirmed: 'Swap transaction confirmed.',
      confirmAuditorApply: 'Confirm the auditor application transaction in your wallet.',
      auditorApplySubmitted: (hash: string) => `Auditor application submitted: ${hash}. Waiting for confirmation.`,
      auditorApplyConfirmed: 'Auditor application is recorded on-chain and waiting for admin approval.',
      confirmAuditorStatus: 'Confirm the auditor status transaction in your wallet.',
      auditorStatusSubmitted: (hash: string) => `Auditor status transaction submitted: ${hash}. Waiting for confirmation.`,
      auditorStatusConfirmed: 'Auditor status updated.',
      confirmAuditReview: 'Confirm the project review transaction in your wallet.',
      auditReviewSubmitted: (hash: string) => `Project review submitted: ${hash}. Waiting for confirmation.`,
      auditReviewConfirmed: 'Project review is recorded on-chain.',
    },
    home: {
      eyebrow: `${appName} Seed Protocol`,
      title: 'Launch a community asset as a complete brand',
      subtitle:
        'Create an independent ERC20 and mint vault, configure minting, taxes, rewards, and the receiver wallet. Every launch is written on-chain and appears in the project list after confirmation.',
      launch: 'Launch token',
      openAuditors: 'Auditors',
      consoleAria: 'Launch flow preview',
      consoleStats: [
        ['Token', appSymbol, '1,000,000,000'],
        ['Mint', '2,000', '0.003 BNB'],
        ['Tax', '3 / 3', 'marketing + burn'],
        ['Mode', 'Seed', 'whitelist ready'],
      ],
      consoleFlow: ['Wallet', 'Factory', 'Token + Vault'],
      features: [
        ['01 Launch', 'Create contracts for 0.005 BNB', 'Wallets submit a real deployment transaction. The Factory is deployed, verified, and writes projects into the on-chain list.'],
        ['02 Minting', 'Independent Mint + Vault', 'Each project has its own ERC20 and mint vault. Users receive real token balances immediately after minting.'],
        ['03 Controls', 'Whitelist and taxes on-chain', 'Buy/sell taxes, rewards, burn, and whitelist mode are stored when the project is created.'],
      ],
    },
    projects: {
      search: 'Search by token name, symbol, or contract address',
      tabs: {
        all: 'On-chain',
        minting: 'Minting',
        whitelist: 'Whitelist',
        completed: 'Completed',
      },
      emptyTitle: 'No projects to show',
      notConfiguredTitle: 'Factory not configured',
      readErrorTitle: 'Could not load on-chain projects',
      firstAction: 'Launch first project',
      deployAction: 'Launch project',
      loading: 'Loading projects',
      progress: 'Mint progress',
      statusMinting: 'Minting',
      statusTrading: 'Trading',
      statusCompleted: 'Completed',
      statusWhitelist: 'Whitelist',
      viewBscScan: 'View on BscScan',
      copyAddress: 'Copy contract',
      copied: 'Copied',
      detail: 'Mechanism',
      trade: 'Trade',
      website: 'Website',
      fallbackDescription: `${appName} Seed launch project`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `Whitelist ${whitelistMinted}/${whitelistTotal} · Public ${publicMinted}/${publicTotal}`,
      whitelistManage: 'Add whitelist',
      whitelistAddress: 'Whitelist wallet',
      whitelistAllowance: 'Mint allowance',
      whitelistSubmit: 'Save allowance',
      whitelistPending: 'Waiting',
      mint: 'Mint',
      mintQuantity: 'Mint quantity',
      mintCost: (amount: string) => `Total ${amount}`,
      approveMint: 'Approve payment',
      whitelistRemaining: (amount: string) => `Whitelist left ${amount}`,
      mintClosed: 'Closed',
      refund: 'Claim refund',
      refundAvailable: (amount: string) => `Refundable ${amount}`,
      refundTip: 'Refunds open if not sold out after 24h',
    },
    detail: {
      eyebrow: 'Project details',
      title: (name: string) => `${name} details`,
      loading: 'Loading on-chain project details',
      missingTitle: 'Project not found',
      missingDesc: 'The project may still be confirming, or this token is not in the current Factory list.',
      back: 'Back to projects',
      mechanism: 'Token mechanism',
      taxMechanism: 'Tax mechanism',
      rewardBadge: (address: string) => `Reward ${shortAddress(address)}`,
      contractBalance: 'Contract balance',
      vaultBalanceHint: 'Vault unminted balance',
      buyTax: 'Buy tax',
      sellTax: 'Sell tax',
      marketing: 'Marketing allocation',
      liquidity: 'Buyback allocation',
      rewards: 'Holder rewards',
      burn: 'Burn allocation',
      platformFee: 'Platform service fee',
      rewardThreshold: 'Reward threshold',
      receiver: 'Receiver wallet',
      vault: 'Vault address',
      token: 'Token contract',
      whitelist: 'Whitelist',
      mintProgress: 'Mint progress',
      supply: 'Total supply',
      tradingState: 'Permission state',
      tradingFinalized: 'Trading is live. Token and Vault ownership are in the black hole.',
      tradingPending: 'Launch phase. Sellout automatically opens trading and burns permissions.',
      enabled: 'Enabled',
      disabled: 'Off',
      unallocated: 'Unallocated',
      toReceiver: (address: string) => `Sent to ${shortAddress(address)}`,
      toPlatform: () => 'Sent to platform service fee',
      toBlackHole: 'Sent to black hole',
      toRewardToken: (address: string) => `Reward token ${shortAddress(address)}`,
      toBurn: 'Burned directly',
      taxPortionPair: (buy: string, sell: string) => (buy === sell ? buy : `Buy ${buy} / sell ${sell}`),
      copyToken: 'Copy Token',
      copyVault: 'Copy Vault',
      openExplorer: 'View BscScan',
      trade: 'Trade',
      noTax: 'No tax',
      tokenUnit: (symbol: string) => symbol,
    },
    swap: {
      title: 'PancakeSwap Trading',
      desc: 'Swap directly through the PancakeSwap V2 Router. Execution depends on the project having BNB liquidity.',
      selectProject: 'Select project',
      customToken: 'Custom token',
      tokenAddress: 'Token contract address',
      amount: 'Amount',
      slippage: 'Slippage',
      buy: 'Buy',
      sell: 'Sell',
      quote: 'Get quote',
      refresh: 'Refresh quote',
      approve: 'Approve token',
      swap: 'Confirm swap',
      pending: 'Waiting',
      route: 'Route',
      expected: 'Expected output',
      minimum: 'Minimum received',
      router: 'Pancake Router',
      noProjects: 'No trading projects yet. You can manually enter a token that already has LP.',
      quoteHint: 'Quote comes from PancakeSwap. Taxed tokens may arrive below the displayed estimate.',
      openPancake: 'Open Pancake',
    },
    launch: {
      network: 'Current network',
      waitingNetwork: 'Waiting for BNB Smart Chain',
      walletHint: 'Connect a wallet to auto-fill the creator receiver address',
      switchNetwork: 'Switch network',
      factoryUnset: 'Not configured',
      section01: '01 Basics',
      title: 'Deploy your launch token',
      intro: 'Fill in the brand name, symbol, description, payment token, mint price, and receiver wallet.',
      feeBadge: 'Deployment fee 0.005 BNB',
      tokenName: 'Token name',
      tokenSymbol: 'Token symbol',
      description: 'Project description',
      section02: '02 Template',
      templateTitle: 'Choose contract template',
      section03: '03 Mint settings',
      mintTitle: 'Mint price and supply',
      supply: 'Total supply',
      mintCount: 'Mint count',
      publicMintCount: 'Public count',
      whitelistMintCount: 'Whitelist count',
      mintPrice: 'Price per mint',
      whitelistTitle: 'Enable whitelist mint',
      whitelistDesc: 'When enabled, only wallets with allowance set by the project owner in the Vault can mint.',
      section04: '04 Taxes and rewards',
      taxTitle: 'Buy/sell taxes and allocation',
      total: (value: number) => `Total ${value}%`,
      buyTax: 'Buy tax',
      sellTax: 'Sell tax',
      unallocated: (value: number) => `Unallocated ${value}%`,
      allocationOverflow: 'Allocation exceeds 100%; the contract will reject deployment.',
      section05: '05 On-chain config',
      receiverTitle: 'Receiver and rewards',
      onchain: 'On-chain record',
      receiverWallet: 'Receiver wallet',
      rewardToken: 'Reward token address',
      rewardTokenPlaceholder: 'Blank defaults to USDT',
      rewardTokenDefault: `Default USDT: ${shortAddress(USDT_ADDRESS)}`,
      rewardThreshold: 'Reward threshold',
      section06: '06 Optional links',
      linksTitle: 'Community links',
      linksDesc: 'Telegram, X, and website are saved with the project metadata. Leaving them empty will not block deployment.',
      telegram: 'Telegram link',
      x: 'X link',
      website: 'Website link',
      configWarning:
        'Real transactions are wired, but the Factory address is not configured yet. Set VITE_LAUNCHPAD_FACTORY_ADDRESS after deploying the contract.',
      pending: 'Waiting for wallet',
      submit: 'Deploy and list on-chain',
      currentTemplate: 'Current template',
      mode: 'Brand launch mode',
      preview: 'Transaction preview',
      deployFee: 'Deployment fee',
      paymentToken: 'Payment token',
      mintQuota: 'Mint quota',
      whitelist: 'Whitelist',
      enabled: 'Enabled',
      disabled: 'Off',
      taxRate: 'Tax rate',
      totalAllocation: 'Total allocation',
      factory: 'Factory',
    },
    auditors: {
      title: 'On-chain auditors',
      desc: 'Auditor applications, admin approval, project scores, and report links are written to the Audit Registry.',
      configWarning: 'Audit Registry is not configured. Deploy AppleAuditRegistry and set VITE_AUDIT_REGISTRY_ADDRESS.',
      registry: 'Audit Registry',
      connect: 'Connect wallet',
      statusTitle: 'My auditor status',
      statusLabels: ['Not applied', 'Applied', 'Approved'],
      statusHelp: ['No on-chain application yet.', 'Application is on-chain and waiting for approval.', 'You can submit project reviews.'],
      profileTitle: 'Apply as auditor',
      profileDesc: 'Profile can be an IPFS URI, website, GitHub, Notion, or prior report page.',
      profileUri: 'Profile link / URI',
      apply: 'Submit application',
      reviewTitle: 'Submit project review',
      reviewDesc: 'Only approved auditors can submit. Re-submitting the same project updates the previous record.',
      projectToken: 'Project token contract',
      score: 'Score 0-100',
      risk: 'Risk level',
      riskLabels: ['Low', 'Medium', 'High', 'Critical'],
      reportUri: 'Report link / URI',
      submitReview: 'Submit on-chain review',
      pending: 'Waiting',
      adminTitle: 'Admin approval',
      adminDesc: 'Only the Registry owner wallet can approve auditors. Auditors only submit reports and do not control launch finalization.',
      auditorWallet: 'Auditor wallet',
      approve: 'Approve',
      ownerOnly: 'Connect the Registry owner wallet to approve auditors.',
      recentTitle: 'Recent reviews',
      emptyReviews: 'No on-chain reviews yet.',
      openReport: 'Open report',
      owner: 'Registry owner',
    },
    verify: {
      title: 'Factory verified',
      subtitle: 'The launch Factory source code is verified on BscScan. Users can inspect constructor arguments and contract code directly.',
      button: 'View BscScan',
    },
  },
} as const

const templateTranslations: Record<Language, Partial<Record<TemplateId, Partial<LaunchTemplate>>>> = {
  zh: {
    standard: {
      name: '标准发射',
      tag: '基础',
    },
    time: {
      name: '分批开放',
      tag: '时间',
    },
    buyback: {
      name: '回流核心',
      tag: '回流',
    },
    nftReward: {
      name: '持币分红',
      tag: '分红',
    },
  },
  en: {
    standard: {
      name: 'Seed Mint',
      tag: 'Core',
      summary: 'Create an independent ERC20 and Vault. Users mint by quantity, which works well for fast community launches.',
      bestFor: 'Community launches, event passes, lightweight asset issuance',
      checks: ['Fixed supply', 'Public mint count', 'Independent Vault', 'Creator receiver wallet'],
    },
    time: {
      name: 'Timed Orchard',
      tag: 'Time',
      summary: 'Keeps room for warm-up, queueing, batch openings, whitelist windows, and launch timing.',
      bestFor: 'Warm-up campaigns, queued launches, staged openings',
      checks: ['Opening time', 'Cooldown window', 'Progress tracking', 'Public parameters'],
    },
    buyback: {
      name: 'Buyback Core',
      tag: 'Flow',
      summary: 'Maps tax splits to marketing, LP black hole, holder rewards, and burn for longer-running projects.',
      bestFor: 'Tax-based mechanics, ongoing operations, buyback narratives',
      checks: ['Buy/sell tax', 'Marketing split', 'LP black hole', 'Receiver wallet'],
    },
    nftReward: {
      name: 'Reward Grove',
      tag: 'Reward',
      summary: 'Records reward token and holding threshold, ready for NFT, task, or membership rewards later.',
      bestFor: 'Task communities, holder rewards, gamified launches',
      checks: ['Reward token', 'Threshold record', 'Template ID', 'Future upgrades'],
    },
  },
}

const allocationTranslations: Record<Language, Record<AllocationKey, { label: string; hint: string }>> = {
  zh: {
    marketing: { label: '营销', hint: '进入接收钱包' },
    liquidity: { label: '回流', hint: 'LP 进入黑洞' },
    rewards: { label: '持币分红', hint: '进入分红池' },
    burn: { label: '销毁', hint: '减少供应' },
  },
  en: {
    marketing: { label: 'Marketing', hint: 'sent to receiver' },
    liquidity: { label: 'Buyback', hint: 'LP sent to black hole' },
    rewards: { label: 'Holder rewards', hint: 'sent to dividend pool' },
    burn: { label: 'Burn', hint: 'reduces supply' },
  },
}

const paymentTokenNotes: Record<Language, Record<string, string>> = {
  zh: {
    BNB: '原生 BNB mint',
    USDT: 'BSC USDT',
  },
  en: {
    BNB: 'Native BNB mint',
    USDT: 'BSC USDT',
  },
}

function App() {
  const [page, setPage] = useState<PageKey>(() => readPageFromHash())
  const [menuOpen, setMenuOpen] = useState(false)
  const [language, setLanguage] = useState<Language>(() => readLanguagePreference())
  const [wallet, setWallet] = useState<WalletState>({
    account: '',
    chainId: '',
    status: 'idle',
    error: '',
  })
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    description: defaultDescriptions[readLanguagePreference()],
  }))
  const [templateId, setTemplateId] = useState<TemplateId>('standard')
  const [allocation, setAllocation] = useState<AllocationState>(initialAllocation)
  const [buyTax, setBuyTax] = useState(3)
  const [sellTax, setSellTax] = useState(3)
  const [whitelistEnabled, setWhitelistEnabled] = useState(true)
  const [deployState, setDeployState] = useState<DeployState>('draft')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [projects, setProjects] = useState<LaunchProject[]>([])
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle')
  const [projectsError, setProjectsError] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectsRefreshKey, setProjectsRefreshKey] = useState(0)
  const [auditDashboard, setAuditDashboard] = useState<AuditDashboard | null>(null)
  const [auditStatus, setAuditStatus] = useState<ProjectsStatus>('idle')
  const [auditError, setAuditError] = useState('')
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)
  const text = copy[language]

  const allocationTotal = useMemo(
    () => Object.values(allocation).reduce((sum, value) => sum + value, 0),
    [allocation],
  )
  const unallocated = Math.max(0, 100 - allocationTotal)
  const onTargetNetwork = wallet.chainId.toLowerCase() === targetChainId

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    localStorage.setItem('apple-launch-language', language)
  }, [language])

  useEffect(() => {
    if (allocationTotal <= 100) {
      return
    }

    setAllocation((current) => normalizeAllocation(current))
  }, [allocationTotal])

  useEffect(() => {
    let active = true

    if (!isLaunchpadConfigured) {
      setProjects([])
      setProjectsStatus('ready')
      setProjectsError('')
      return () => {
        active = false
      }
    }

    setProjectsStatus('loading')
    setProjectsError('')

    fetchLaunchProjects(wallet.account)
      .then((items) => {
        if (!active) {
          return
        }

        setProjects(items)
        setProjectsStatus('ready')
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setProjects([])
        setProjectsStatus('error')
        setProjectsError(readProviderErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [projectsRefreshKey, wallet.account])

  useEffect(() => {
    let active = true

    if (!isAuditRegistryConfigured) {
      setAuditDashboard(null)
      setAuditStatus('ready')
      setAuditError('')
      return () => {
        active = false
      }
    }

    setAuditStatus('loading')
    setAuditError('')

    fetchAuditDashboard(wallet.account)
      .then((dashboard) => {
        if (!active) {
          return
        }

        setAuditDashboard(dashboard)
        setAuditStatus('ready')
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setAuditDashboard(null)
        setAuditStatus('error')
        setAuditError(readProviderErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [auditRefreshKey, wallet.account])

  useEffect(() => {
    const handleHashChange = () => {
      setPage(readPageFromHash())
      setMenuOpen(false)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const provider = getProvider()

    if (!provider) {
      setWallet((current) => ({ ...current, status: 'missing' }))
      return
    }

    let active = true

    Promise.all([getAccounts(provider), getChainId(provider)])
      .then(([accounts, chainId]) => {
        if (!active) {
          return
        }

        const account = accounts[0] ?? ''
        setWallet({
          account,
          chainId,
          status: account ? 'connected' : 'idle',
          error: '',
        })

        if (account) {
          setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
        }
      })
      .catch((error) => {
        setWallet({
          account: '',
          chainId: '',
          status: 'error',
          error: readProviderErrorMessage(error),
        })
      })

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : []
      const account = accounts[0] ?? ''

      setWallet((current) => ({
        ...current,
        account,
        status: account ? 'connected' : 'idle',
        error: '',
      }))

      if (account) {
        setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
      }
    }

    const handleChainChanged = (...args: unknown[]) => {
      setWallet((current) => ({
        ...current,
        chainId: String(args[0] ?? '').toLowerCase(),
        error: '',
      }))
    }

    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)

    return () => {
      active = false
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
    setForm((current) => {
      if (current.description === defaultDescriptions.zh || current.description === defaultDescriptions.en) {
        return { ...current, description: defaultDescriptions[nextLanguage] }
      }

      return current
    })
  }

  const connectWallet = async () => {
    const provider = getProvider()

    if (!provider) {
      setWallet({
        account: '',
        chainId: '',
        status: 'missing',
        error: text.wallet.missing,
      })
      return
    }

    setWallet((current) => ({ ...current, status: 'connecting', error: '' }))

    try {
      const accounts = await requestAccounts(provider)
      const chainId = await getChainId(provider)
      const account = accounts[0] ?? ''

      if (!account) {
        throw new Error(text.wallet.noAccount)
      }

      setWallet({
        account,
        chainId,
        status: 'connected',
        error: '',
      })
      setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
    } catch (error) {
      setWallet((current) => ({
        ...current,
        status: 'error',
        error: readProviderErrorMessage(error),
      }))
    }
  }

  const switchNetwork = async () => {
    const provider = getProvider()

    if (!provider) {
      setWallet((current) => ({ ...current, status: 'missing', error: text.wallet.missingShort }))
      return
    }

    try {
      const chainId = await switchToBnbChain(provider)
      setWallet((current) => ({ ...current, chainId, error: '' }))
    } catch (error) {
      setWallet((current) => ({ ...current, status: 'error', error: readProviderErrorMessage(error) }))
    }
  }

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateAllocation = (key: AllocationKey, value: number) => {
    setAllocation((current) => {
      const otherTotal = Object.entries(current).reduce(
        (sum, [itemKey, itemValue]) => sum + (itemKey === key ? 0 : itemValue),
        0,
      )
      const nextValue = Math.min(value, Math.max(0, 100 - otherTotal))

      return { ...current, [key]: nextValue }
    })
  }

  const submitLaunch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!wallet.account) {
      await connectWallet()
      return
    }

    if (!onTargetNetwork) {
      await switchNetwork()
      return
    }

    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    setDeployState('pending')
    setNotice({ kind: 'info', message: text.notice.confirmDeploy })

    try {
      const result = await createLaunchToken(
        provider,
        {
          form,
          allocation,
          buyTax,
          sellTax,
          templateId,
          avatar: '',
          whitelistEnabled: whitelistEnabled || Number(form.whitelistMintCount) > 0,
        },
        language,
      )

      setDeployState('sent')
      setNotice({ kind: 'info', message: text.notice.txSubmitted(shortHash(result.hash)) })

      try {
        await waitForTransactionReceipt(provider, result.hash, 120_000, language)
        setNotice({ kind: 'success', message: text.notice.txConfirmed })
        setProjectsRefreshKey((current) => current + 1)
        navigate('home')
      } catch (error) {
        const message = readProviderErrorMessage(error)
        const failed = /失败|failed|revert/i.test(message)
        setDeployState(failed ? 'blocked' : 'sent')
        setNotice({ kind: failed ? 'error' : 'info', message })
        setProjectsRefreshKey((current) => current + 1)
      }
    } catch (error) {
      setDeployState('blocked')
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitWhitelistAllowance = async (project: LaunchProject, account: string, allowance: string) => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    setNotice({ kind: 'info', message: text.notice.confirmWhitelist })

    try {
      if (wallet.account && !onTargetNetwork) {
        await switchNetwork()
      }

      if (!wallet.account) {
        const accounts = await requestAccounts(provider)
        const chainId = await getChainId(provider)
        setWallet({
          account: accounts[0] ?? '',
          chainId,
          status: accounts[0] ? 'connected' : 'idle',
          error: accounts[0] ? '' : text.wallet.noAccount,
        })
      }

      const result = await setProjectWhitelistAllowance(provider, project.vault, account, allowance, language)
      setNotice({ kind: 'info', message: text.notice.whitelistSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.whitelistConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitProjectMint = async (project: LaunchProject, quantity: string) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      const cost = getMintCostWei(project, quantity)

      if (
        project.paymentToken.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
        BigInt(project.mintPaymentAllowance || '0') < cost
      ) {
        setNotice({ kind: 'info', message: text.notice.confirmMintApproval })
        const approval = await approveProjectMintPayment(
          provider,
          project.paymentToken,
          project.vault,
          cost.toString(),
          language,
        )
        setNotice({ kind: 'info', message: text.notice.mintApprovalSubmitted(shortHash(approval.hash)) })
        await waitForTransactionReceipt(provider, approval.hash, 120_000, language)
        setNotice({ kind: 'info', message: text.notice.mintApprovalConfirmed })
      }

      setNotice({ kind: 'info', message: text.notice.confirmMint })
      const result = await mintLaunchProject(provider, project, quantity, language)
      setNotice({ kind: 'info', message: text.notice.mintSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.mintConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitProjectRefund = async (project: LaunchProject) => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    try {
      if (wallet.account && !onTargetNetwork) {
        await switchNetwork()
      }

      if (!wallet.account) {
        const accounts = await requestAccounts(provider)
        const chainId = await getChainId(provider)
        setWallet({
          account: accounts[0] ?? '',
          chainId,
          status: accounts[0] ? 'connected' : 'idle',
          error: accounts[0] ? '' : text.wallet.noAccount,
        })
      }

      if (project.refundNeedsApproval) {
        setNotice({ kind: 'info', message: text.notice.confirmRefundApproval })
        const approval = await approveProjectRefundTokens(
          provider,
          project.token,
          project.vault,
          project.refundTokenAmount,
          language,
        )
        setNotice({ kind: 'info', message: text.notice.refundApprovalSubmitted(shortHash(approval.hash)) })
        await waitForTransactionReceipt(provider, approval.hash, 120_000, language)
        setNotice({ kind: 'info', message: text.notice.refundApprovalConfirmed })
      }

      setNotice({ kind: 'info', message: text.notice.confirmRefund })
      const result = await claimProjectRefund(provider, project.vault, language)
      setNotice({ kind: 'info', message: text.notice.refundSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.refundConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const prepareWalletTransaction = async () => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return null
    }

    let nextChainId = wallet.chainId
    if (!wallet.account) {
      const accounts = await requestAccounts(provider)
      const chainId = await getChainId(provider)
      nextChainId = chainId
      setWallet({
        account: accounts[0] ?? '',
        chainId,
        status: accounts[0] ? 'connected' : 'idle',
        error: accounts[0] ? '' : text.wallet.noAccount,
      })
    }

    if (nextChainId.toLowerCase() !== targetChainId) {
      await switchNetwork()
    }

    return provider
  }

  const submitAuditorApplication = async (profileUri: string) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({ kind: 'info', message: text.notice.confirmAuditorApply })
      const result = await applyForAuditor(provider, profileUri, language)
      setNotice({ kind: 'info', message: text.notice.auditorApplySubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.auditorApplyConfirmed })
      setAuditRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitAuditorStatus = async (auditor: string, status: AuditorStatus) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({ kind: 'info', message: text.notice.confirmAuditorStatus })
      const result = await setAuditorStatus(provider, auditor, status, language)
      setNotice({ kind: 'info', message: text.notice.auditorStatusSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.auditorStatusConfirmed })
      setAuditRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitProjectAudit = async (
    projectToken: string,
    score: string,
    riskLevel: RiskLevel,
    reportUri: string,
  ) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({ kind: 'info', message: text.notice.confirmAuditReview })
      const result = await submitAuditReview(provider, projectToken, score, riskLevel, reportUri, language)
      setNotice({ kind: 'info', message: text.notice.auditReviewSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.auditReviewConfirmed })
      setAuditRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitSwapApproval = async (tokenAddress: string, amountIn: string) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({ kind: 'info', message: text.notice.confirmSwapApproval })
      const result = await approvePancakeSwapToken(provider, tokenAddress, amountIn, language)
      setNotice({ kind: 'info', message: text.notice.swapApprovalSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.swapApprovalConfirmed })
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
      throw error
    }
  }

  const submitSwap = async (request: PancakeSwapRequest) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({ kind: 'info', message: text.notice.confirmSwap })
      const result = await executePancakeSwap(provider, { ...request, locale: language })
      setNotice({ kind: 'info', message: text.notice.swapSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.swapConfirmed })
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
      throw error
    }
  }

  const navigate = (nextPage: PageKey) => {
    window.location.hash = nextPage === 'home' ? '#/' : `#/${nextPage}`
    setPage(nextPage)
    setMenuOpen(false)
  }

  const openSwap = (tokenAddress?: string) => {
    window.location.hash = tokenAddress ? `#/swap?token=${tokenAddress}` : '#/swap'
    setPage('swap')
    setMenuOpen(false)
  }

  const openProjectDetail = (tokenAddress: string) => {
    window.location.hash = `#/detail?token=${tokenAddress}`
    setPage('detail')
    setMenuOpen(false)
  }

  const openFactory = () => {
    window.open(factoryExplorerUrl, '_blank', 'noreferrer')
  }

  const visibleNotice = wallet.error ? { kind: 'error' as const, message: wallet.error } : notice

  return (
    <div className="app">
      <Header
        activePage={page}
        connectWallet={connectWallet}
        language={language}
        menuOpen={menuOpen}
        navigate={navigate}
        setLanguage={changeLanguage}
        setMenuOpen={setMenuOpen}
        text={text}
        wallet={wallet}
      />

      {visibleNotice && (
        <div className={`toast ${visibleNotice.kind}`}>
          {visibleNotice.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {visibleNotice.message}
        </div>
      )}

      {page === 'home' && (
        <HomePage
          language={language}
          navigate={navigate}
          openProjectDetail={openProjectDetail}
          openSwap={openSwap}
          projectQuery={projectQuery}
          projects={projects}
          projectsError={projectsError}
          projectsStatus={projectsStatus}
          setProjectQuery={setProjectQuery}
          submitProjectMint={submitProjectMint}
          submitProjectRefund={submitProjectRefund}
          submitWhitelistAllowance={submitWhitelistAllowance}
          text={text}
          wallet={wallet}
        />
      )}
      {page === 'swap' && (
        <SwapPage
          connectWallet={connectWallet}
          initialTokenAddress={readSwapTokenFromHash()}
          language={language}
          projects={projects}
          projectsStatus={projectsStatus}
          submitSwap={submitSwap}
          submitSwapApproval={submitSwapApproval}
          text={text}
          wallet={wallet}
        />
      )}
      {page === 'detail' && (
        <ProjectDetailPage
          initialTokenAddress={readDetailTokenFromHash()}
          language={language}
          navigate={navigate}
          openSwap={openSwap}
          projects={projects}
          projectsStatus={projectsStatus}
          text={text}
        />
      )}
      {page === 'launch' && (
        <LaunchPage
          allocation={allocation}
          allocationTotal={allocationTotal}
          buyTax={buyTax}
          deployState={deployState}
          form={form}
          isConfigured={isLaunchpadConfigured}
          language={language}
          onSubmit={submitLaunch}
          onTargetNetwork={onTargetNetwork}
          sellTax={sellTax}
          setBuyTax={setBuyTax}
          setSellTax={setSellTax}
          setTemplateId={setTemplateId}
          setWhitelistEnabled={setWhitelistEnabled}
          switchNetwork={switchNetwork}
          templateId={templateId}
          text={text}
          unallocated={unallocated}
          updateAllocation={updateAllocation}
          updateForm={updateForm}
          wallet={wallet}
          whitelistEnabled={whitelistEnabled}
        />
      )}
      {page === 'auditors' && (
        <AuditorsPage
          auditDashboard={auditDashboard}
          auditError={auditError}
          auditStatus={auditStatus}
          connectWallet={connectWallet}
          submitAuditorApplication={submitAuditorApplication}
          submitAuditorStatus={submitAuditorStatus}
          submitProjectAudit={submitProjectAudit}
          text={text}
          wallet={wallet}
        />
      )}
      {page === 'verify' && (
        <SimplePanel
          button={text.verify.button}
          icon={<FileCode2 size={24} />}
          onClick={openFactory}
          subtitle={text.verify.subtitle}
          title={text.verify.title}
        />
      )}
    </div>
  )
}

function Header({
  activePage,
  connectWallet,
  language,
  menuOpen,
  navigate,
  setLanguage,
  setMenuOpen,
  text,
  wallet,
}: {
  activePage: PageKey
  connectWallet: () => void
  language: Language
  menuOpen: boolean
  navigate: (page: PageKey) => void
  setLanguage: (value: Language) => void
  setMenuOpen: (value: boolean) => void
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const nav = [
    { page: 'home' as PageKey, label: text.nav.home, icon: <Home size={17} /> },
    { page: 'swap' as PageKey, label: text.nav.swap, icon: <ArrowUpDown size={17} /> },
    { page: 'auditors' as PageKey, label: text.nav.auditors, icon: <ShieldCheck size={17} /> },
    { page: 'verify' as PageKey, label: text.nav.verify, icon: <FileCode2 size={17} /> },
  ]
  const socialLinks = [
    { href: normalizeExternalUrl(import.meta.env.VITE_TELEGRAM_URL), label: 'Telegram', icon: <Send size={17} /> },
    { href: normalizeExternalUrl(import.meta.env.VITE_X_URL), label: 'X', icon: <AtSign size={17} /> },
    { href: normalizeExternalUrl(import.meta.env.VITE_QQ_URL), label: 'QQ', icon: <MessageCircle size={17} /> },
  ].filter((item) => item.href)

  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/"
        onClick={(event) => {
          event.preventDefault()
          navigate('home')
        }}
        aria-label={appName}
      >
        <span className="brand-mark">
          <img src="/apple-logo.jpg" alt="" />
        </span>
        <span>
          <strong>{appName}</strong>
          <small>
            {activePage === 'launch'
              ? 'Seed'
              : activePage === 'auditors'
                ? 'Audit'
                : activePage === 'swap' ? 'Swap' : 'Launch'}
          </small>
        </span>
      </a>

      <button
        className="menu-button"
        type="button"
        aria-label={menuOpen ? text.menuClose : text.menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      <nav className={menuOpen ? 'nav is-open' : 'nav'} aria-label={text.mainNav}>
        {socialLinks.map((item) => (
          <a href={item.href} key={item.label} target="_blank" rel="noreferrer" title={item.label}>
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
        {nav.map((item) => (
          <button
            className={activePage === item.page ? 'nav-button active' : 'nav-button'}
            key={item.page}
            type="button"
            onClick={() => navigate(item.page)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <button className="deploy-nav" type="button" onClick={() => navigate('launch')}>
          <Rocket size={17} />
          {text.nav.launch}
        </button>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.status === 'connecting' ? text.wallet.connecting : wallet.account ? shortAddress(wallet.account) : text.wallet.connect}
        </button>
        <label className="language-select">
          <Languages size={16} />
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </nav>
    </header>
  )
}

function HomePage({
  language,
  navigate,
  openProjectDetail,
  openSwap,
  projectQuery,
  projects,
  projectsError,
  projectsStatus,
  setProjectQuery,
  submitProjectMint,
  submitProjectRefund,
  submitWhitelistAllowance,
  text,
  wallet,
}: {
  language: Language
  navigate: (page: PageKey) => void
  openProjectDetail: (tokenAddress: string) => void
  openSwap: (tokenAddress?: string) => void
  projectQuery: string
  projects: LaunchProject[]
  projectsError: string
  projectsStatus: ProjectsStatus
  setProjectQuery: (value: string) => void
  submitProjectMint: (project: LaunchProject, quantity: string) => Promise<void>
  submitProjectRefund: (project: LaunchProject) => Promise<void>
  submitWhitelistAllowance: (project: LaunchProject, account: string, allowance: string) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const normalizedQuery = projectQuery.trim().toLowerCase()
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        const matchesQuery =
          !normalizedQuery ||
          project.name.toLowerCase().includes(normalizedQuery) ||
          project.symbol.toLowerCase().includes(normalizedQuery) ||
          project.token.toLowerCase().includes(normalizedQuery) ||
          project.vault.toLowerCase().includes(normalizedQuery)

        if (!matchesQuery) {
          return false
        }

        if (filter === 'whitelist') {
          return project.whitelistEnabled
        }

        if (filter === 'completed') {
          return project.progress >= 100
        }

        if (filter === 'minting') {
          return project.progress < 100
        }

        return true
      }),
    [filter, normalizedQuery, projects],
  )

  const filterTabs: Array<{ key: ProjectFilter; label: string }> = [
    { key: 'all', label: text.projects.tabs.all },
    { key: 'minting', label: text.projects.tabs.minting },
    { key: 'whitelist', label: text.projects.tabs.whitelist },
    { key: 'completed', label: text.projects.tabs.completed },
  ]

  return (
    <main className="page">
      <section className="home-hero">
        <div className="hero-copy">
          <p>{text.home.eyebrow}</p>
          <h1>{text.home.title}</h1>
          <span>{text.home.subtitle}</span>
          <div className="banner-actions">
            <button className="primary-button" type="button" onClick={() => navigate('launch')}>
              <Rocket size={18} />
              {text.home.launch}
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('auditors')}>
              <ShieldCheck size={18} />
              {text.home.openAuditors}
            </button>
          </div>
        </div>

        <div className="hero-console" aria-label={text.home.consoleAria}>
          <div className="console-head">
            <span>{appSymbol} SEED</span>
            <strong>0.005 BNB</strong>
          </div>
          <div className="console-grid">
            {text.home.consoleStats.map((item) => (
              <div key={item[0]}>
                <small>{item[0]}</small>
                <strong>{item[1]}</strong>
                <span>{item[2]}</span>
              </div>
            ))}
          </div>
          <div className="console-flow">
            <span>{text.home.consoleFlow[0]}</span>
            <i />
            <span>{text.home.consoleFlow[1]}</span>
            <i />
            <span>{text.home.consoleFlow[2]}</span>
          </div>
        </div>
      </section>

      <section className="feature-grid">
        {text.home.features.map((feature) => (
          <article className="feature-card" key={feature[0]}>
            <p>{feature[0]}</p>
            <h2>{feature[1]}</h2>
            <span>{feature[2]}</span>
          </article>
        ))}
      </section>

      <section className="project-board">
        <div className="board-tools">
          <label className="project-search">
            <Search size={20} />
            <input
              placeholder={text.projects.search}
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
            />
          </label>
          <div className="filter-tabs">
            {filterTabs.map((item) => (
              <button
                className={filter === item.key ? 'active' : ''}
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {projectsStatus === 'loading' && (
          <div className="project-grid">
            <ProjectSkeleton label={text.projects.loading} />
            <ProjectSkeleton label={text.projects.loading} />
            <ProjectSkeleton label={text.projects.loading} />
          </div>
        )}

        {projectsStatus !== 'loading' && projectsError && (
          <ProjectEmptyState
            actionLabel={text.projects.deployAction}
            message={projectsError}
            title={text.projects.readErrorTitle}
            onAction={() => navigate('launch')}
          />
        )}

        {projectsStatus !== 'loading' && !projectsError && filteredProjects.length === 0 && (
          <ProjectEmptyState
            actionLabel={text.projects.firstAction}
            message={readProjectEmptyMessage(projects.length, normalizedQuery, language)}
            title={isLaunchpadConfigured ? text.projects.emptyTitle : text.projects.notConfiguredTitle}
            onAction={() => navigate('launch')}
          />
        )}

        {projectsStatus !== 'loading' && !projectsError && filteredProjects.length > 0 && (
          <div className="project-grid">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.token}
                language={language}
                openProjectDetail={openProjectDetail}
                openSwap={openSwap}
                project={project}
                submitProjectMint={submitProjectMint}
                submitProjectRefund={submitProjectRefund}
                submitWhitelistAllowance={submitWhitelistAllowance}
                text={text}
                wallet={wallet}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ProjectSkeleton({ label }: { label: string }) {
  return (
    <article className="project-card project-skeleton" aria-label={label}>
      <div className="project-head">
        <span />
        <div>
          <h3 />
          <p />
        </div>
        <em />
      </div>
      <div className="progress-track" />
      <div className="project-meta">
        <span />
        <span />
      </div>
    </article>
  )
}

function ProjectEmptyState({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel: string
  message: string
  onAction: () => void
  title: string
}) {
  return (
    <div className="project-empty">
      <div className="simple-icon">
        <Rocket size={22} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      <button type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  )
}

function ProjectCard({
  language,
  openProjectDetail,
  openSwap,
  project,
  submitProjectMint,
  submitProjectRefund,
  submitWhitelistAllowance,
  text,
  wallet,
}: {
  language: Language
  openProjectDetail: (tokenAddress: string) => void
  openSwap: (tokenAddress?: string) => void
  project: LaunchProject
  submitProjectMint: (project: LaunchProject, quantity: string) => Promise<void>
  submitProjectRefund: (project: LaunchProject) => Promise<void>
  submitWhitelistAllowance: (project: LaunchProject, account: string, allowance: string) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [copied, setCopied] = useState(false)
  const [mintQuantity, setMintQuantity] = useState('1')
  const [mintPending, setMintPending] = useState(false)
  const [whitelistAccount, setWhitelistAccount] = useState('')
  const [whitelistAllowance, setWhitelistAllowance] = useState('1')
  const [whitelistSaving, setWhitelistSaving] = useState(false)
  const [refundPending, setRefundPending] = useState(false)
  const progress = Math.min(100, Math.max(0, project.progress))
  const mintExpired = project.refundDeadline > 0 && Date.now() >= project.refundDeadline * 1000
  const mintOpen = !project.finalized && progress < 100 && !mintExpired
  const mintCostWei = getMintCostWei(project, mintQuantity)
  const mintNeedsApproval =
    project.paymentToken.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
    BigInt(project.mintPaymentAllowance || '0') < mintCostWei
  const status = project.finalized
    ? text.projects.statusTrading
    : progress >= 100
      ? text.projects.statusCompleted
      : project.whitelistEnabled ? text.projects.statusWhitelist : text.projects.statusMinting
  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const canManageWhitelist =
    !project.finalized &&
    Boolean(wallet.account) &&
    wallet.account.toLowerCase() === project.creator.toLowerCase()
  const createdAt =
    project.createdAt > 0
      ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(project.createdAt * 1000)
      : language === 'zh'
        ? '链上记录'
        : 'On-chain'

  return (
    <article className="project-card">
      <div className="project-head">
        <span>{project.symbol.slice(0, 1).toUpperCase()}</span>
        <div>
          <h3>{project.name}</h3>
          <div className="project-identity">
            <span>
              {project.symbol} · {shortAddress(project.token)} · {createdAt}
            </span>
            <button
              className={copied ? 'copy-address copied' : 'copy-address'}
              type="button"
              title={copied ? text.projects.copied : text.projects.copyAddress}
              onClick={async () => {
                await copyTextToClipboard(project.token)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              <Copy size={13} />
              {copied ? text.projects.copied : text.projects.copyAddress}
            </button>
          </div>
        </div>
        <em>{status}</em>
      </div>
      <p className="project-description">{project.description || text.projects.fallbackDescription}</p>
      <div className="progress-row">
        <span>{text.projects.progress}</span>
        <strong>{progress.toFixed(2)}%</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="project-meta">
        <span>
          {project.mintedCount}/{project.mintCount}
        </span>
        <span>{project.mintPrice}</span>
      </div>
      <div className="project-quota">
        {text.projects.quota(
          project.whitelistMintedCount,
          project.whitelistMintCount,
          project.publicMintedCount,
          project.publicMintCount,
        )}
      </div>
      <div className={project.canRefund ? 'refund-state available' : 'refund-state'}>
        {project.canRefund && project.userRefundAmount
          ? text.projects.refundAvailable(project.userRefundAmount)
          : text.projects.refundTip}
      </div>
      {!project.finalized && progress < 100 && (
        <form
          className="mint-panel"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!mintOpen || mintPending) {
              return
            }
            setMintPending(true)
            try {
              await submitProjectMint(project, mintQuantity)
            } finally {
              setMintPending(false)
            }
          }}
        >
          <div>
            <label>
              <span>{text.projects.mintQuantity}</span>
              <input
                inputMode="numeric"
                min="1"
                type="number"
                value={mintQuantity}
                onChange={(event) => setMintQuantity(normalizeMintInput(event.target.value))}
              />
            </label>
            <strong>{text.projects.mintCost(formatMintCost(project, mintQuantity))}</strong>
          </div>
          {project.whitelistEnabled && wallet.account && (
            <em>{text.projects.whitelistRemaining(project.whitelistRemaining)}</em>
          )}
          <button className="submit-button" type="submit" disabled={!mintOpen || mintPending}>
            <Rocket size={16} />
            {mintPending
              ? text.projects.whitelistPending
              : mintOpen
                ? mintNeedsApproval ? text.projects.approveMint : text.projects.mint
                : text.projects.mintClosed}
          </button>
        </form>
      )}
      <div className="project-links">
        {project.website && (
          <a href={project.website} target="_blank" rel="noreferrer" title={text.projects.website}>
            <Globe2 size={15} />
          </a>
        )}
        {project.telegram && (
          <a href={project.telegram} target="_blank" rel="noreferrer" title="Telegram">
            <Send size={15} />
          </a>
        )}
        {project.xLink && (
          <a href={project.xLink} target="_blank" rel="noreferrer" title="X">
            <AtSign size={15} />
          </a>
        )}
      </div>
      <div className="project-actions">
        <button type="button" onClick={() => window.open(explorerUrl, '_blank', 'noreferrer')}>
          <ExternalLink size={16} />
          {text.projects.viewBscScan}
        </button>
        <button type="button" onClick={() => openProjectDetail(project.token)}>
          <FileCode2 size={16} />
          {text.projects.detail}
        </button>
        {project.finalized && (
          <button type="button" onClick={() => openSwap(project.token)}>
            <ArrowUpDown size={16} />
            {text.projects.trade}
          </button>
        )}
        {project.canRefund && (
          <button
            type="button"
            disabled={refundPending}
            onClick={async () => {
              setRefundPending(true)
              try {
                await submitProjectRefund(project)
              } finally {
                setRefundPending(false)
              }
            }}
          >
            <Wallet size={16} />
            {refundPending ? text.projects.whitelistPending : text.projects.refund}
          </button>
        )}
      </div>
      {canManageWhitelist && (
        <form
          className="whitelist-manager"
          onSubmit={async (event) => {
            event.preventDefault()
            setWhitelistSaving(true)
            try {
              await submitWhitelistAllowance(project, whitelistAccount, whitelistAllowance)
              setWhitelistAccount('')
            } finally {
              setWhitelistSaving(false)
            }
          }}
        >
          <strong>
            <UserPlus size={15} />
            {text.projects.whitelistManage}
          </strong>
          <div className="whitelist-fields">
            <input
              placeholder={text.projects.whitelistAddress}
              value={whitelistAccount}
              onChange={(event) => setWhitelistAccount(event.target.value)}
            />
            <input
              inputMode="numeric"
              min="1"
              placeholder={text.projects.whitelistAllowance}
              type="number"
              value={whitelistAllowance}
              onChange={(event) => setWhitelistAllowance(event.target.value)}
            />
          </div>
          <button type="submit" disabled={whitelistSaving}>
            {whitelistSaving ? text.projects.whitelistPending : text.projects.whitelistSubmit}
          </button>
        </form>
      )}
    </article>
  )
}

function ProjectDetailPage({
  initialTokenAddress,
  language,
  navigate,
  openSwap,
  projects,
  projectsStatus,
  text,
}: {
  initialTokenAddress: string
  language: Language
  navigate: (page: PageKey) => void
  openSwap: (tokenAddress?: string) => void
  projects: LaunchProject[]
  projectsStatus: ProjectsStatus
  text: (typeof copy)[Language]
}) {
  const [copiedKey, setCopiedKey] = useState('')
  const normalizedToken = initialTokenAddress.toLowerCase()
  const project = projects.find((item) => item.token.toLowerCase() === normalizedToken)
  const allocation = allocationTranslations[language]

  const copyAddress = async (key: string, value: string) => {
    await copyTextToClipboard(value)
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey(''), 1400)
  }

  if (projectsStatus === 'loading') {
    return (
      <main className="page narrow">
        <section className="simple-panel">
          <div className="simple-icon">
            <Rocket size={22} />
          </div>
          <h1>{text.detail.loading}</h1>
          <p>{initialTokenAddress || launchpadConfig.factoryAddress}</p>
        </section>
      </main>
    )
  }

  if (!project) {
    return (
      <main className="page narrow">
        <section className="simple-panel">
          <div className="simple-icon">
            <AlertCircle size={22} />
          </div>
          <h1>{text.detail.missingTitle}</h1>
          <p>{text.detail.missingDesc}</p>
          <button className="submit-button" type="button" onClick={() => navigate('home')}>
            <Rocket size={18} />
            {text.detail.back}
          </button>
        </section>
      </main>
    )
  }

  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const splitTotal = project.fundFeeBps + project.lpFeeBps + project.dividendFeeBps + project.burnFeeBps
  const unallocatedBps = Math.max(0, 10_000 - splitTotal)
  const marketingSplitBps = project.fundFeeBps + unallocatedBps
  const platformShareBps = Math.min(10_000, Math.max(0, project.platformFeeBps))
  const taxShare = (taxBps: number, shareBps: number) => (taxBps * shareBps) / 10_000
  const platformTaxPortion = (taxBps: number) => taxShare(taxBps, platformShareBps)
  const projectTaxPortion = (taxBps: number, splitBps: number) => {
    const projectTaxBps = taxBps - platformTaxPortion(taxBps)
    return taxShare(projectTaxBps, splitBps)
  }
  const portionPair = (splitBps: number) =>
    text.detail.taxPortionPair(
      formatTaxPortionBps(projectTaxPortion(project.buyTaxBps, splitBps)),
      formatTaxPortionBps(projectTaxPortion(project.sellTaxBps, splitBps)),
    )
  const platformPortionPair = () =>
    text.detail.taxPortionPair(
      formatTaxPortionBps(platformTaxPortion(project.buyTaxBps)),
      formatTaxPortionBps(platformTaxPortion(project.sellTaxBps)),
    )
  const taxSummary = (taxBps: number) => {
    if (taxBps <= 0) {
      return text.detail.noTax
    }

    const splitSummary = [
      ...(platformShareBps > 0
        ? [`${text.detail.platformFee} ${formatTaxPortionBps(platformTaxPortion(taxBps))}`]
        : []),
      `${allocation.marketing.label} ${formatTaxPortionBps(projectTaxPortion(taxBps, marketingSplitBps))}`,
      `${allocation.liquidity.label} ${formatTaxPortionBps(projectTaxPortion(taxBps, project.lpFeeBps))}`,
      `${allocation.rewards.label} ${formatTaxPortionBps(projectTaxPortion(taxBps, project.dividendFeeBps))}`,
      `${allocation.burn.label} ${formatTaxPortionBps(projectTaxPortion(taxBps, project.burnFeeBps))}`,
    ]

    return `${formatBps(taxBps)} (${splitSummary.join(' / ')})`
  }
  const progress = Math.min(100, Math.max(0, project.progress))

  return (
    <main className="page detail-page">
      <section className="detail-hero">
        <div className="detail-title">
          <span>{project.symbol.slice(0, 1).toUpperCase()}</span>
          <div>
            <p>{text.detail.eyebrow}</p>
            <h1>{text.detail.title(project.name)}</h1>
            <small>
              {project.symbol} · {shortAddress(project.token)}
            </small>
          </div>
        </div>
        <div className="detail-actions">
          <button type="button" onClick={() => navigate('home')}>
            <Rocket size={16} />
            {text.detail.back}
          </button>
          <button type="button" onClick={() => copyAddress('token', project.token)}>
            <Copy size={16} />
            {copiedKey === 'token' ? text.projects.copied : text.detail.copyToken}
          </button>
          <button type="button" onClick={() => window.open(explorerUrl, '_blank', 'noreferrer')}>
            <ExternalLink size={16} />
            {text.detail.openExplorer}
          </button>
          {project.finalized && (
            <button className="submit-button" type="button" onClick={() => openSwap(project.token)}>
              <ArrowUpDown size={16} />
              {text.detail.trade}
            </button>
          )}
        </div>
      </section>

      <section className="detail-grid">
        <div className="mechanism-panel">
          <div className="mechanism-head">
            <div>
              <p>{text.detail.taxMechanism}</p>
              <h2>{text.detail.mechanism}</h2>
            </div>
            <span>{text.detail.rewardBadge(project.rewardToken)}</span>
          </div>

          <DetailRow
            label={text.detail.contractBalance}
            value={`${formatDisplayAmount(project.vaultTokenBalance)} ${project.symbol}`}
            helper={text.detail.vaultBalanceHint}
          />
          <DetailRow label={text.detail.buyTax} value={taxSummary(project.buyTaxBps)} />
          <DetailRow label={text.detail.sellTax} value={taxSummary(project.sellTaxBps)} />
          {platformShareBps > 0 && (
            <DetailRow
              label={text.detail.platformFee}
              value={`${platformPortionPair()} -> ${text.detail.toPlatform()}`}
            />
          )}
          <DetailRow
            label={text.detail.marketing}
            value={`${portionPair(marketingSplitBps)} -> ${text.detail.toReceiver(project.receiver)}`}
          />
          <DetailRow
            label={text.detail.liquidity}
            value={`${portionPair(project.lpFeeBps)} -> ${text.detail.toBlackHole}`}
          />
          <DetailRow
            label={text.detail.rewards}
            value={`${portionPair(project.dividendFeeBps)} -> ${text.detail.toRewardToken(project.rewardToken)}`}
          />
          <DetailRow
            label={text.detail.burn}
            value={`${portionPair(project.burnFeeBps)} -> ${text.detail.toBurn}`}
          />
          <DetailRow
            label={text.detail.rewardThreshold}
            value={`${formatDisplayAmount(project.rewardThreshold)} ${text.detail.tokenUnit(project.symbol)}`}
          />
          <DetailRow
            label={text.detail.tradingState}
            value={project.finalized ? text.detail.tradingFinalized : text.detail.tradingPending}
          />
        </div>

        <aside className="detail-side">
          <div className="detail-stat-panel">
            <p>{text.detail.mintProgress}</p>
            <strong>{progress.toFixed(2)}%</strong>
            <div className="progress-track">
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>
              {project.mintedCount}/{project.mintCount}
            </span>
          </div>

          <div className="detail-stat-list">
            <DetailMiniStat label={text.detail.supply} value={`${formatDisplayAmount(project.totalSupply)} ${project.symbol}`} />
            <DetailMiniStat
              label={text.detail.whitelist}
              value={project.whitelistEnabled ? text.detail.enabled : text.detail.disabled}
            />
            <DetailMiniStat label={text.detail.receiver} value={shortAddress(project.receiver)} />
          </div>

          <div className="address-panel">
            <AddressLine
              copied={copiedKey === 'token'}
              label={text.detail.token}
              value={project.token}
              copiedText={text.projects.copied}
              copyText={text.detail.copyToken}
              onCopy={() => copyAddress('token', project.token)}
            />
            <AddressLine
              copied={copiedKey === 'vault'}
              label={text.detail.vault}
              value={project.vault}
              copiedText={text.projects.copied}
              copyText={text.detail.copyVault}
              onCopy={() => copyAddress('vault', project.vault)}
            />
          </div>
        </aside>
      </section>
    </main>
  )
}

function DetailRow({ helper, label, value }: { helper?: string; label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <em>{helper}</em>}
    </div>
  )
}

function DetailMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AddressLine({
  copied,
  copiedText,
  copyText,
  label,
  onCopy,
  value,
}: {
  copied: boolean
  copiedText: string
  copyText: string
  label: string
  onCopy: () => void
  value: string
}) {
  return (
    <div className="address-line">
      <span>{label}</span>
      <strong>{shortAddress(value)}</strong>
      <button type="button" onClick={onCopy}>
        <Copy size={14} />
        {copied ? copiedText : copyText}
      </button>
    </div>
  )
}

function SwapPage({
  connectWallet,
  initialTokenAddress,
  language,
  projects,
  projectsStatus,
  submitSwap,
  submitSwapApproval,
  text,
  wallet,
}: {
  connectWallet: () => void
  initialTokenAddress: string
  language: Language
  projects: LaunchProject[]
  projectsStatus: ProjectsStatus
  submitSwap: (request: PancakeSwapRequest) => Promise<void>
  submitSwapApproval: (tokenAddress: string, amountIn: string) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [tokenAddress, setTokenAddress] = useState(initialTokenAddress)
  const [direction, setDirection] = useState<PancakeSwapDirection>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('8')
  const [quote, setQuote] = useState<PancakeSwapQuote | null>(null)
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [quoteError, setQuoteError] = useState('')
  const [pendingAction, setPendingAction] = useState('')
  const tradableProjects = projects.filter((project) => project.finalized)
  const selectedProject = tradableProjects.find(
    (project) => project.token.toLowerCase() === tokenAddress.trim().toLowerCase(),
  )

  useEffect(() => {
    if (initialTokenAddress) {
      setTokenAddress(initialTokenAddress)
    }
  }, [initialTokenAddress])

  useEffect(() => {
    setQuote(null)
    setQuoteError('')
    setQuoteStatus('idle')
  }, [amount, direction, slippage, tokenAddress])

  const readQuote = async () => {
    setQuoteStatus('loading')
    setQuoteError('')

    try {
      const nextQuote = await fetchPancakeSwapQuote({
        tokenAddress,
        amount,
        direction,
        slippageBps: slippageToBps(slippage),
        account: wallet.account,
        locale: language,
      })
      setQuote(nextQuote)
      setQuoteStatus('ready')
    } catch (error) {
      setQuote(null)
      setQuoteStatus('error')
      setQuoteError(readProviderErrorMessage(error))
    }
  }

  const approve = async () => {
    if (!quote) {
      return
    }

    setPendingAction('approve')
    try {
      await submitSwapApproval(tokenAddress, quote.amountIn)
      await readQuote()
    } finally {
      setPendingAction('')
    }
  }

  const swap = async () => {
    setPendingAction('swap')
    try {
      await submitSwap({
        tokenAddress,
        amount,
        direction,
        slippageBps: slippageToBps(slippage),
        locale: language,
      })
      setQuote(null)
      setQuoteStatus('idle')
    } finally {
      setPendingAction('')
    }
  }

  return (
    <main className="page narrow">
      <section className="swap-hero">
        <div>
          <p>PancakeSwap V2</p>
          <h1>{text.swap.title}</h1>
          <span>{text.swap.desc}</span>
        </div>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.account ? shortAddress(wallet.account) : text.wallet.connect}
        </button>
      </section>

      <section className="swap-grid">
        <form
          className="swap-card"
          onSubmit={(event) => {
            event.preventDefault()
            void readQuote()
          }}
        >
          <div className="swap-mode" role="group" aria-label={text.swap.title}>
            <button
              className={direction === 'buy' ? 'active' : ''}
              type="button"
              onClick={() => setDirection('buy')}
            >
              {text.swap.buy}
            </button>
            <button
              className={direction === 'sell' ? 'active' : ''}
              type="button"
              onClick={() => setDirection('sell')}
            >
              {text.swap.sell}
            </button>
          </div>

          <label className="field">
            <span>{text.swap.selectProject}</span>
            <select
              value={selectedProject ? selectedProject.token : 'custom'}
              onChange={(event) => {
                if (event.target.value !== 'custom') {
                  setTokenAddress(event.target.value)
                }
              }}
            >
              <option value="custom">{text.swap.customToken}</option>
              {tradableProjects.map((project) => (
                <option key={project.token} value={project.token}>
                  {project.name} ({project.symbol})
                </option>
              ))}
            </select>
          </label>

          <InputField label={text.swap.tokenAddress} value={tokenAddress} onChange={setTokenAddress} />

          <div className="fields two">
            <InputField label={`${text.swap.amount} ${direction === 'buy' ? 'BNB' : quote?.tokenSymbol ?? ''}`} value={amount} onChange={setAmount} />
            <InputField label={text.swap.slippage} value={slippage} onChange={setSlippage} />
          </div>

          <button className="submit-button" type="submit" disabled={quoteStatus === 'loading'}>
            <ArrowUpDown size={18} />
            {quoteStatus === 'loading' ? text.swap.pending : quote ? text.swap.refresh : text.swap.quote}
          </button>

          {projectsStatus !== 'loading' && tradableProjects.length === 0 && (
            <p className="muted-line">{text.swap.noProjects}</p>
          )}

          {quoteError && (
            <div className="config-warning compact-warning">
              <AlertCircle size={17} />
              {quoteError}
            </div>
          )}

          {quote && (
            <div className="swap-quote">
              <div>
                <span>{text.swap.route}</span>
                <strong>{quote.routeLabel}</strong>
              </div>
              <div>
                <span>{text.swap.expected}</span>
                <strong>
                  {quote.formattedAmountOut} {quote.targetSymbol}
                </strong>
              </div>
              <div>
                <span>{text.swap.minimum}</span>
                <strong>
                  {quote.formattedMinimumAmountOut} {quote.targetSymbol}
                </strong>
              </div>
            </div>
          )}

          <div className="swap-actions">
            {quote?.needsApproval && (
              <button type="button" disabled={pendingAction === 'approve'} onClick={approve}>
                <Wallet size={16} />
                {pendingAction === 'approve' ? text.swap.pending : text.swap.approve}
              </button>
            )}
            <button
              className="submit-button"
              type="button"
              disabled={!quote || quote.needsApproval || pendingAction === 'swap'}
              onClick={swap}
            >
              <ArrowUpDown size={18} />
              {pendingAction === 'swap' ? text.swap.pending : text.swap.swap}
            </button>
          </div>
        </form>

        <aside className="swap-card swap-side">
          <div className="audit-facts">
            <div>
              <span>{text.swap.router}</span>
              <strong>{shortAddress(PANCAKE_V2_ROUTER_ADDRESS)}</strong>
            </div>
            <div>
              <span>{text.swap.route}</span>
              <strong>{quote?.routeLabel ?? (direction === 'buy' ? 'BNB -> TOKEN' : 'TOKEN -> BNB')}</strong>
            </div>
          </div>
          <p className="muted-line">{text.swap.quoteHint}</p>
          <button
            className="ghost-button"
            type="button"
            onClick={() => window.open(buildPancakeSwapUrl(tokenAddress, direction), '_blank', 'noreferrer')}
          >
            <ExternalLink size={17} />
            {text.swap.openPancake}
          </button>
        </aside>
      </section>
    </main>
  )
}

function LaunchPage({
  allocation,
  allocationTotal,
  buyTax,
  deployState,
  form,
  isConfigured,
  language,
  onSubmit,
  onTargetNetwork,
  sellTax,
  setBuyTax,
  setSellTax,
  setTemplateId,
  setWhitelistEnabled,
  switchNetwork,
  templateId,
  text,
  unallocated,
  updateAllocation,
  updateForm,
  wallet,
  whitelistEnabled,
}: {
  allocation: AllocationState
  allocationTotal: number
  buyTax: number
  deployState: DeployState
  form: FormState
  isConfigured: boolean
  language: Language
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onTargetNetwork: boolean
  sellTax: number
  setBuyTax: (value: number) => void
  setSellTax: (value: number) => void
  setTemplateId: (value: TemplateId) => void
  setWhitelistEnabled: (value: boolean) => void
  switchNetwork: () => void
  templateId: TemplateId
  text: (typeof copy)[Language]
  unallocated: number
  updateAllocation: (key: AllocationKey, value: number) => void
  updateForm: <Key extends keyof FormState>(key: Key, value: FormState[Key]) => void
  wallet: WalletState
  whitelistEnabled: boolean
}) {
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? templates[0]
  const selectedTemplateText = translateTemplate(selectedTemplate, language)
  const selectedPayment =
    paymentTokens.find((token) => token.address.toLowerCase() === form.paymentToken.toLowerCase()) ??
    paymentTokens[0]
  const totalMintCount = Number(form.publicMintCount || 0) + Number(form.whitelistMintCount || 0)

  return (
    <main className="page narrow">
      <section className="status-strip">
        <div className={wallet.account ? 'status-dot ok' : 'status-dot'} />
        <div>
          <p>{text.launch.network}</p>
          <strong>{onTargetNetwork ? BNB_CHAIN.chainName : text.launch.waitingNetwork}</strong>
          <span>
            {wallet.account
              ? `${shortAddress(wallet.account)} · ${text.launch.factory} ${
                  isConfigured ? shortAddress(launchpadConfig.factoryAddress) : text.launch.factoryUnset
                }`
              : text.launch.walletHint}
          </span>
        </div>
        {!onTargetNetwork && wallet.account && (
          <button type="button" onClick={switchNetwork}>
            {text.launch.switchNetwork}
          </button>
        )}
      </section>

      <form className="launch-grid" onSubmit={onSubmit}>
        <div className="launch-form">
          <section className="form-section">
            <div className="section-head">
              <div>
                <p>{text.launch.section01}</p>
                <h1>{text.launch.title}</h1>
                <span>{text.launch.intro}</span>
              </div>
              <strong>{text.launch.feeBadge}</strong>
            </div>

            <div className="fields two">
              <InputField label={text.launch.tokenName} value={form.tokenName} onChange={(value) => updateForm('tokenName', value)} />
              <InputField label={text.launch.tokenSymbol} value={form.symbol} onChange={(value) => updateForm('symbol', value.toUpperCase())} />
            </div>
            <label className="field">
              <span>{text.launch.description}</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
              />
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section02}</p>
                <h2>{text.launch.templateTitle}</h2>
              </div>
              <strong>{selectedTemplateText.tag}</strong>
            </div>
            <div className="template-grid">
              {templates.map((item) => {
                const itemText = translateTemplate(item, language)

                return (
                  <button
                    className={item.id === templateId ? 'template-card active' : 'template-card'}
                    key={item.id}
                    type="button"
                    onClick={() => setTemplateId(item.id)}
                  >
                    <span>{itemText.tag}</span>
                    <strong>{itemText.name}</strong>
                    <em>{itemText.summary}</em>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section03}</p>
                <h2>{text.launch.mintTitle}</h2>
              </div>
              <strong>{selectedPayment.label}</strong>
            </div>
            <div className="payment-grid">
              {paymentTokens.map((token) => (
                <button
                  className={token.address === form.paymentToken ? 'payment-token active' : 'payment-token'}
                  key={token.address}
                  type="button"
                  onClick={() => updateForm('paymentToken', token.address)}
                >
                  <strong>{token.symbol}</strong>
                  <span>{paymentTokenNotes[language][token.symbol] ?? token.note}</span>
                </button>
              ))}
            </div>
            <div className="fields two">
              <InputField label={text.launch.supply} value={form.supply} onChange={(value) => updateForm('supply', value)} />
              <InputField
                label={text.launch.publicMintCount}
                value={form.publicMintCount}
                onChange={(value) => updateForm('publicMintCount', value)}
              />
              <InputField
                label={text.launch.whitelistMintCount}
                value={form.whitelistMintCount}
                onChange={(value) => {
                  updateForm('whitelistMintCount', value)
                  setWhitelistEnabled(Number(value) > 0)
                }}
              />
              <InputField label={text.launch.mintPrice} value={form.mintPrice} onChange={(value) => updateForm('mintPrice', value)} />
            </div>
            <div className="quota-summary">
              <span>{text.launch.mintCount}</span>
              <strong>{Number.isFinite(totalMintCount) ? totalMintCount.toLocaleString() : 0}</strong>
            </div>
            <label className="switch-row">
              <input
                checked={whitelistEnabled}
                type="checkbox"
                onChange={(event) => {
                  const checked = event.target.checked
                  setWhitelistEnabled(checked)
                  if (!checked) {
                    updateForm('whitelistMintCount', '0')
                  } else if (Number(form.whitelistMintCount) <= 0) {
                    updateForm('whitelistMintCount', '200')
                  }
                }}
              />
              <span>
                <strong>{text.launch.whitelistTitle}</strong>
                <em>{text.launch.whitelistDesc}</em>
              </span>
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section04}</p>
                <h2>{text.launch.taxTitle}</h2>
              </div>
              <strong>{text.launch.total(allocationTotal)}</strong>
            </div>
            <div className="tax-box">
              <SliderField label={text.launch.buyTax} value={buyTax} max={25} onChange={setBuyTax} />
              <SliderField label={text.launch.sellTax} value={sellTax} max={25} onChange={setSellTax} />
              <div className="tax-split">
                <TaxRing allocation={allocation} language={language} totalLabel={text.launch.totalAllocation} />
                <div className="tax-sliders">
                  {allocationMeta.map((item) => {
                    const itemText = allocationTranslations[language][item.key]

                    return (
                      <SliderField
                        key={item.key}
                        label={`${itemText.label} · ${itemText.hint}`}
                        max={100}
                        value={allocation[item.key]}
                        onChange={(value) => updateAllocation(item.key, value)}
                      />
                    )
                  })}
                  <p className={allocationTotal > 100 ? 'tax-warning' : 'tax-note'}>
                    {allocationTotal > 100 ? text.launch.allocationOverflow : text.launch.unallocated(unallocated)}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section05}</p>
                <h2>{text.launch.receiverTitle}</h2>
              </div>
              <strong>{text.launch.onchain}</strong>
            </div>
            <div className="fields three">
              <InputField label={text.launch.receiverWallet} value={form.receiverWallet} onChange={(value) => updateForm('receiverWallet', value)} />
              <label className="field">
                <span>{text.launch.rewardToken}</span>
                <input
                  placeholder={text.launch.rewardTokenPlaceholder}
                  value={form.rewardToken}
                  onChange={(event) => updateForm('rewardToken', event.target.value)}
                />
                <em>{text.launch.rewardTokenDefault}</em>
              </label>
              <InputField label={text.launch.rewardThreshold} value={form.rewardThreshold} onChange={(value) => updateForm('rewardThreshold', value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section06}</p>
                <h2>{text.launch.linksTitle}</h2>
                <span>{text.launch.linksDesc}</span>
              </div>
              <strong>{text.optional}</strong>
            </div>
            <div className="link-fields">
              <LinkField
                icon={<Send size={18} />}
                label={text.launch.telegram}
                placeholder={text.optional}
                value={form.telegram}
                onChange={(value) => updateForm('telegram', value)}
              />
              <LinkField
                icon={<AtSign size={18} />}
                label={text.launch.x}
                placeholder={text.optional}
                value={form.xLink}
                onChange={(value) => updateForm('xLink', value)}
              />
              <LinkField
                icon={<Globe2 size={18} />}
                label={text.launch.website}
                placeholder={text.optional}
                value={form.website}
                onChange={(value) => updateForm('website', value)}
              />
            </div>
          </section>

          {!isConfigured && (
            <div className="config-warning">
              <AlertCircle size={18} />
              {text.launch.configWarning}
            </div>
          )}

          <button className="submit-button" type="submit" disabled={deployState === 'pending'}>
            <Rocket size={18} />
            {deployState === 'pending'
              ? text.launch.pending
              : !wallet.account
                ? text.wallet.connect
                : !onTargetNetwork
                  ? text.launch.switchNetwork
                  : text.launch.submit}
          </button>
        </div>

        <aside className="launch-side">
          <div className="side-orbit">
            <strong>Seed</strong>
            <span>{text.launch.mode}</span>
          </div>
          <div className="side-card">
            <p>{text.launch.currentTemplate}</p>
            <h3>{selectedTemplate.name}</h3>
            <span>{selectedTemplateText.bestFor}</span>
            <ul>
              {selectedTemplateText.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
          <div className="side-card">
            <p>{text.launch.preview}</p>
            <dl>
              <div>
                <dt>{text.launch.factory}</dt>
                <dd>{isConfigured ? shortAddress(launchpadConfig.factoryAddress) : text.launch.factoryUnset}</dd>
              </div>
              <div>
                <dt>{text.launch.deployFee}</dt>
                <dd>0.005 BNB</dd>
              </div>
              <div>
                <dt>{text.launch.paymentToken}</dt>
                <dd>{selectedPayment.symbol}</dd>
              </div>
              <div>
                <dt>{text.launch.mintQuota}</dt>
                <dd>{totalMintCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{text.launch.whitelist}</dt>
                <dd>{whitelistEnabled ? text.launch.enabled : text.launch.disabled}</dd>
              </div>
              <div>
                <dt>{text.launch.taxRate}</dt>
                <dd>
                  {buyTax}% / {sellTax}%
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </form>
    </main>
  )
}

function InputField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function LinkField({
  icon,
  label,
  onChange,
  placeholder,
  value,
}: {
  icon: ReactNode
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="link-field">
      <span className="link-icon">{icon}</span>
      <strong>{label}</strong>
      <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SliderField({
  label,
  max,
  onChange,
  value,
}: {
  label: string
  max: number
  onChange: (value: number) => void
  value: number
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <input
        max={max}
        min={0}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function TaxRing({
  allocation,
  language,
  totalLabel,
}: {
  allocation: AllocationState
  language: Language
  totalLabel: string
}) {
  let cursor = 0
  const stops = allocationMeta.map((item) => {
    const start = cursor
    cursor += allocation[item.key]
    return `${item.color} ${start}% ${cursor}%`
  })
  const style = {
    '--tax-ring': `conic-gradient(${stops.join(', ')}, rgba(255,255,255,.1) ${cursor}% 100%)`,
  } as CSSProperties

  return (
    <div className="tax-ring-wrap">
      <div className="tax-ring" style={style}>
        <strong>{cursor}%</strong>
        <span>{totalLabel}</span>
      </div>
      <div className="tax-ring-legend">
        {allocationMeta.map((item) => {
          const itemText = allocationTranslations[language][item.key]

          return (
            <span key={item.key} style={{ '--dot-color': item.color } as CSSProperties}>
              <i />
              {itemText.label}
              <b>{allocation[item.key]}%</b>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function AuditorsPage({
  auditDashboard,
  auditError,
  auditStatus,
  connectWallet,
  submitAuditorApplication,
  submitAuditorStatus,
  submitProjectAudit,
  text,
  wallet,
}: {
  auditDashboard: AuditDashboard | null
  auditError: string
  auditStatus: ProjectsStatus
  connectWallet: () => void
  submitAuditorApplication: (profileUri: string) => Promise<void>
  submitAuditorStatus: (auditor: string, status: AuditorStatus) => Promise<void>
  submitProjectAudit: (
    projectToken: string,
    score: string,
    riskLevel: RiskLevel,
    reportUri: string,
  ) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [profileUri, setProfileUri] = useState('')
  const [auditorWallet, setAuditorWallet] = useState('')
  const [projectToken, setProjectToken] = useState('')
  const [score, setScore] = useState('88')
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(1)
  const [reportUri, setReportUri] = useState('')
  const [pendingAction, setPendingAction] = useState('')
  const profile = auditDashboard?.profile ?? {
    status: 0 as AuditorStatus,
    profileUri: '',
    appliedAt: 0,
    approvedAt: 0,
    reviewCount: '0',
  }
  const isOwner =
    Boolean(wallet.account && auditDashboard?.owner) &&
    wallet.account.toLowerCase() === String(auditDashboard?.owner).toLowerCase()
  const isApproved = profile.status === 2
  const statusLabel = text.auditors.statusLabels[profile.status] ?? text.auditors.statusLabels[0]
  const statusHelp = text.auditors.statusHelp[profile.status] ?? text.auditors.statusHelp[0]

  return (
    <main className="page narrow">
      <section className="auditor-hero">
        <div>
          <p>{text.auditors.registry}</p>
          <h1>{text.auditors.title}</h1>
          <span>{text.auditors.desc}</span>
        </div>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.account ? shortAddress(wallet.account) : text.auditors.connect}
        </button>
      </section>

      {!isAuditRegistryConfigured && (
        <div className="config-warning">
          <AlertCircle size={18} />
          {text.auditors.configWarning}
        </div>
      )}

      {auditError && (
        <div className="config-warning">
          <AlertCircle size={18} />
          {auditError}
        </div>
      )}

      <section className="auditor-grid">
        <article className="auditor-card">
          <div className="section-head compact">
            <div>
              <p>{text.auditors.statusTitle}</p>
              <h2>{statusLabel}</h2>
              <span>{statusHelp}</span>
            </div>
            <strong>{profile.reviewCount}</strong>
          </div>
          <div className="audit-facts">
            <div>
              <span>{text.auditors.owner}</span>
              <strong>{auditDashboard?.owner ? shortAddress(auditDashboard.owner) : '-'}</strong>
            </div>
            <div>
              <span>{text.auditors.profileUri}</span>
              <strong>{profile.profileUri || '-'}</strong>
            </div>
          </div>
        </article>

        <form
          className="auditor-card"
          onSubmit={async (event) => {
            event.preventDefault()
            setPendingAction('apply')
            try {
              await submitAuditorApplication(profileUri)
              setProfileUri('')
            } finally {
              setPendingAction('')
            }
          }}
        >
          <div className="section-head compact">
            <div>
              <p>{text.auditors.profileTitle}</p>
              <h2>{text.auditors.apply}</h2>
              <span>{text.auditors.profileDesc}</span>
            </div>
          </div>
          <InputField
            label={text.auditors.profileUri}
            value={profileUri}
            onChange={setProfileUri}
          />
          <button className="submit-button" type="submit" disabled={!isAuditRegistryConfigured || pendingAction === 'apply'}>
            <Wallet size={18} />
            {pendingAction === 'apply' ? text.auditors.pending : text.auditors.apply}
          </button>
        </form>

        <form
          className="auditor-card wide"
          onSubmit={async (event) => {
            event.preventDefault()
            setPendingAction('review')
            try {
              await submitProjectAudit(projectToken, score, riskLevel, reportUri)
              setReportUri('')
            } finally {
              setPendingAction('')
            }
          }}
        >
          <div className="section-head compact">
            <div>
              <p>{text.auditors.reviewTitle}</p>
              <h2>{text.auditors.submitReview}</h2>
              <span>{text.auditors.reviewDesc}</span>
            </div>
            <strong>{isApproved ? statusLabel : text.auditors.statusLabels[profile.status]}</strong>
          </div>
          <div className="fields two">
            <InputField label={text.auditors.projectToken} value={projectToken} onChange={setProjectToken} />
            <InputField label={text.auditors.score} value={score} onChange={setScore} />
          </div>
          <label className="field">
            <span>{text.auditors.risk}</span>
            <select value={riskLevel} onChange={(event) => setRiskLevel(Number(event.target.value) as RiskLevel)}>
              {text.auditors.riskLabels.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <InputField label={text.auditors.reportUri} value={reportUri} onChange={setReportUri} />
          <button className="submit-button" type="submit" disabled={!isAuditRegistryConfigured || !isApproved || pendingAction === 'review'}>
            <ShieldCheck size={18} />
            {pendingAction === 'review' ? text.auditors.pending : text.auditors.submitReview}
          </button>
        </form>

        <form
          className="auditor-card"
          onSubmit={async (event) => {
            event.preventDefault()
            setPendingAction('approve')
            try {
              await submitAuditorStatus(auditorWallet, 2)
            } finally {
              setPendingAction('')
            }
          }}
        >
          <div className="section-head compact">
            <div>
              <p>{text.auditors.adminTitle}</p>
              <h2>{isOwner ? text.auditors.approve : text.auditors.ownerOnly}</h2>
              <span>{text.auditors.adminDesc}</span>
            </div>
          </div>
          <InputField label={text.auditors.auditorWallet} value={auditorWallet} onChange={setAuditorWallet} />
          <button className="submit-button" type="submit" disabled={!isOwner || pendingAction === 'approve'}>
            <UserPlus size={18} />
            {pendingAction === 'approve' ? text.auditors.pending : text.auditors.approve}
          </button>
        </form>
      </section>

      <section className="auditor-card review-board">
        <div className="section-head compact">
          <div>
            <p>{text.auditors.recentTitle}</p>
            <h2>{auditStatus === 'loading' ? text.projects.loading : text.auditors.recentTitle}</h2>
          </div>
        </div>
        {auditDashboard?.recentReviews.length ? (
          <div className="review-list">
            {auditDashboard.recentReviews.map((review) => (
              <article className="review-row" key={`${review.projectToken}-${review.auditor}`}>
                <div>
                  <strong>{shortAddress(review.projectToken)}</strong>
                  <span>
                    {shortAddress(review.auditor)} · {formatAuditDate(review.updatedAt)}
                  </span>
                </div>
                <em>{text.auditors.riskLabels[review.riskLevel]}</em>
                <b>{review.score}/100</b>
                <button type="button" onClick={() => window.open(normalizeReportUrl(review.reportUri), '_blank', 'noreferrer')}>
                  <ExternalLink size={15} />
                  {text.auditors.openReport}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-line">{text.auditors.emptyReviews}</p>
        )}
      </section>
    </main>
  )
}

function SimplePanel({
  button,
  icon,
  onClick,
  subtitle,
  title,
}: {
  button: string
  icon: ReactNode
  onClick: () => void
  subtitle: string
  title: string
}) {
  return (
    <main className="page narrow">
      <section className="simple-panel">
        <div className="simple-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <button className="submit-button" type="button" onClick={onClick}>
          <ExternalLink size={18} />
          {button}
        </button>
      </section>
    </main>
  )
}

function translateTemplate(template: LaunchTemplate, language: Language) {
  const translation = templateTranslations[language][template.id]

  return {
    ...template,
    ...translation,
  }
}

function readProjectEmptyMessage(projectCount: number, query: string, language: Language) {
  if (!isLaunchpadConfigured) {
    return language === 'zh'
      ? '部署 Factory 后，把地址写入 VITE_LAUNCHPAD_FACTORY_ADDRESS，这里会读取真实链上项目。'
      : 'Deploy the Factory and set VITE_LAUNCHPAD_FACTORY_ADDRESS to read real on-chain projects here.'
  }

  if (projectCount > 0 && query) {
    return language === 'zh'
      ? '没有找到匹配的项目，可以换一个名称、符号或合约地址。'
      : 'No matching project found. Try another name, symbol, or contract address.'
  }

  if (projectCount > 0) {
    return language === 'zh' ? '当前筛选条件下没有项目。' : 'No projects match the current filter.'
  }

  return language === 'zh'
    ? '暂无链上项目。有人完成发布并确认交易后，会自动出现在这里。'
    : 'No on-chain projects yet. Once someone launches and the transaction confirms, it will appear here automatically.'
}

function readLanguagePreference(): Language {
  const value = localStorage.getItem('apple-launch-language')
  return value === 'en' ? 'en' : 'zh'
}

function readPageFromHash(): PageKey {
  const rawPage = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return pages.includes(rawPage as PageKey) ? (rawPage as PageKey) : 'home'
}

function readSwapTokenFromHash() {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('token') ?? ''
}

function readDetailTokenFromHash() {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('token') ?? ''
}

function normalizeMintInput(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')

  return digits || '1'
}

function getMintCostWei(project: LaunchProject, quantity: string) {
  const mintQuantity = /^\d+$/.test(quantity.trim()) ? BigInt(quantity.trim()) : 1n

  return BigInt(project.mintPriceWei || '0') * mintQuantity
}

function formatMintCost(project: LaunchProject, quantity: string) {
  return `${formatWeiAmount(getMintCostWei(project, quantity))} ${project.paymentSymbol}`
}

function formatWeiAmount(value: bigint) {
  const unit = 1_000_000_000_000_000_000n
  const whole = value / unit
  const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6)

  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function formatBps(value: number) {
  const percent = Number(value || 0) / 100
  const fixed = percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed

  return `${trimmed}%`
}

function formatTaxPortionBps(value: number) {
  const percent = Number(value || 0) / 100

  if (!Number.isFinite(percent) || percent <= 0) {
    return '0%'
  }

  return `${percent.toFixed(2)}%`
}

function formatDisplayAmount(value: string) {
  const rawValue = String(value || '0')
  const [whole = '0', fraction = ''] = rawValue.split('.')
  const cleanFraction = fraction.replace(/0+$/, '').slice(0, 4)
  const cleanWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const groupedWhole = cleanWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return cleanFraction ? `${groupedWhole}.${cleanFraction}` : groupedWhole
}

function slippageToBps(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.round(parsed * 100)
}

function shortHash(hash: string) {
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : ''
}

function normalizeAllocation(allocation: AllocationState) {
  const next = { ...allocation }
  let overflow = Object.values(next).reduce((sum, value) => sum + value, 0) - 100

  for (const key of ['burn', 'rewards', 'liquidity', 'marketing'] as AllocationKey[]) {
    if (overflow <= 0) {
      break
    }

    const reduction = Math.min(next[key], overflow)
    next[key] -= reduction
    overflow -= reduction
  }

  return next
}

function normalizeExternalUrl(value: unknown) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return ''
  }

  return /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
}

function normalizeReportUrl(value: string) {
  const rawValue = value.trim()

  if (/^ipfs:\/\//i.test(rawValue)) {
    return `https://ipfs.io/ipfs/${rawValue.replace(/^ipfs:\/\//i, '')}`
  }

  return normalizeExternalUrl(rawValue)
}

function formatAuditDate(value: number) {
  if (!value) {
    return '-'
  }

  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN'

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value * 1000)
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export default App
