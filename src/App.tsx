import {
  AlertCircle,
  ArrowDownUp,
  AtSign,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
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
  Settings,
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
  createLaunchToken,
  fetchLaunchProjects,
  isLaunchpadConfigured,
  launchpadConfig,
  setProjectWhitelistAllowance,
  waitForTransactionReceipt,
} from './contracts/launchpad'
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

const pages: PageKey[] = ['home', 'launch', 'swap', 'auditors', 'verify']
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
      swap: 'Swap',
      auditors: '审核员',
      verify: '合约开源',
      launch: '部署代币',
    },
    notice: {
      confirmDeploy: '请在钱包里确认部署交易，部署费为 0.005 BNB。',
      txSubmitted: (hash: string) => `部署交易已提交：${hash}，正在等待链上确认。`,
      txConfirmed: '交易已确认，项目已经写入链上列表。',
      confirmWhitelist: '请在钱包里确认白名单额度交易。',
      whitelistSubmitted: (hash: string) => `白名单交易已提交：${hash}，正在等待链上确认。`,
      whitelistConfirmed: '白名单额度已写入链上。',
    },
    home: {
      eyebrow: `${appName} Seed Protocol`,
      title: '把社区资产发射成一个完整品牌',
      subtitle:
        '创建独立 ERC20 和独立 Vault，配置 mint、税收、奖励和接收钱包。每一次发射都会写入链上，确认后自动出现在项目列表。',
      launch: '部署代币',
      openSwap: '打开 Swap',
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
      statusCompleted: '已完成',
      statusWhitelist: '白名单',
      viewBscScan: '在 BscScan 查看',
      copyAddress: '复制合约',
      copied: '已复制',
      website: '官网',
      fallbackDescription: `${appName} 链上发射项目`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `白名单 ${whitelistMinted}/${whitelistTotal} · 公开 ${publicMinted}/${publicTotal}`,
      whitelistManage: '添加白名单',
      whitelistAddress: '白名单钱包地址',
      whitelistAllowance: '可 mint 次数',
      whitelistSubmit: '保存额度',
      whitelistPending: '等待确认',
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
    swap: {
      eyebrow: `${appName} Swap`,
      title: `为 ${appName} 资产预留的交易入口`,
      subtitle:
        '当前发射合约已上线；Swap 模块会在接入 Pancake Router 后开放，避免用户误以为现在已经可以兑换。',
      settings: '设置',
      switchDirection: '切换方向',
      autoSlippage: '自动滑点 13%',
      deadline: '有效期 20 分钟',
      selectToken: '路由待接入',
      cardTitle: '兑换',
      from: '支付',
      to: '获得',
    },
    auditors: {
      title: '审核员工作台',
      desc: '审核员申请和评分体系还没有开放真实链上流程，因此这里先保留流程入口，不展示假队列。',
      connect: '连接钱包申请',
      workflowTitle: '审核流程',
      steps: [
        ['01', '提交钱包身份'],
        ['02', '核对项目参数与开源状态'],
        ['03', '记录风险标签与复核意见'],
      ],
      ready: '就绪',
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
      swap: 'Swap',
      auditors: 'Auditors',
      verify: 'Verified',
      launch: 'Launch token',
    },
    notice: {
      confirmDeploy: 'Confirm the deployment transaction in your wallet. The launch fee is 0.005 BNB.',
      txSubmitted: (hash: string) => `Deployment transaction submitted: ${hash}. Waiting for confirmation.`,
      txConfirmed: 'Transaction confirmed. The project is now recorded in the on-chain list.',
      confirmWhitelist: 'Confirm the whitelist allowance transaction in your wallet.',
      whitelistSubmitted: (hash: string) => `Whitelist transaction submitted: ${hash}. Waiting for confirmation.`,
      whitelistConfirmed: 'Whitelist allowance is now recorded on-chain.',
    },
    home: {
      eyebrow: `${appName} Seed Protocol`,
      title: 'Launch a community asset as a complete brand',
      subtitle:
        'Create an independent ERC20 and mint vault, configure minting, taxes, rewards, and the receiver wallet. Every launch is written on-chain and appears in the project list after confirmation.',
      launch: 'Launch token',
      openSwap: 'Open Swap',
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
      statusCompleted: 'Completed',
      statusWhitelist: 'Whitelist',
      viewBscScan: 'View on BscScan',
      copyAddress: 'Copy contract',
      copied: 'Copied',
      website: 'Website',
      fallbackDescription: `${appName} Seed launch project`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `Whitelist ${whitelistMinted}/${whitelistTotal} · Public ${publicMinted}/${publicTotal}`,
      whitelistManage: 'Add whitelist',
      whitelistAddress: 'Whitelist wallet',
      whitelistAllowance: 'Mint allowance',
      whitelistSubmit: 'Save allowance',
      whitelistPending: 'Waiting',
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
    swap: {
      eyebrow: `${appName} Swap`,
      title: `A reserved trading entry for ${appName} assets`,
      subtitle:
        'The launch Factory is live. Swap will open after Pancake Router is connected, so users are not misled into thinking trading is already active.',
      settings: 'Settings',
      switchDirection: 'Switch direction',
      autoSlippage: 'Auto Slippage 13%',
      deadline: 'Deadline 20m',
      selectToken: 'Router pending',
      cardTitle: 'Swap',
      from: 'From',
      to: 'To',
    },
    auditors: {
      title: 'Auditor workspace',
      desc: 'Auditor applications and scoring are not live on-chain yet, so this page keeps the workflow visible without showing a fake queue.',
      connect: 'Connect to apply',
      workflowTitle: 'Review flow',
      steps: [
        ['01', 'Submit wallet identity'],
        ['02', 'Check project parameters and verification'],
        ['03', 'Record risk tags and review notes'],
      ],
      ready: 'Ready',
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

    fetchLaunchProjects()
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
  }, [projectsRefreshKey])

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

  const navigate = (nextPage: PageKey) => {
    window.location.hash = nextPage === 'home' ? '#/' : `#/${nextPage}`
    setPage(nextPage)
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
          projectQuery={projectQuery}
          projects={projects}
          projectsError={projectsError}
          projectsStatus={projectsStatus}
          setProjectQuery={setProjectQuery}
          submitWhitelistAllowance={submitWhitelistAllowance}
          text={text}
          wallet={wallet}
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
      {page === 'swap' && <SwapPage connectWallet={connectWallet} text={text} wallet={wallet} />}
      {page === 'auditors' && <AuditorsPage connectWallet={connectWallet} text={text} />}
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
    { page: 'swap' as PageKey, label: text.nav.swap, icon: <CircleDollarSign size={17} /> },
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
          <small>{activePage === 'launch' ? 'Seed' : activePage === 'swap' ? 'Swap' : 'Launch'}</small>
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
  projectQuery,
  projects,
  projectsError,
  projectsStatus,
  setProjectQuery,
  submitWhitelistAllowance,
  text,
  wallet,
}: {
  language: Language
  navigate: (page: PageKey) => void
  projectQuery: string
  projects: LaunchProject[]
  projectsError: string
  projectsStatus: ProjectsStatus
  setProjectQuery: (value: string) => void
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
            <button className="ghost-button" type="button" onClick={() => navigate('swap')}>
              <ArrowDownUp size={18} />
              {text.home.openSwap}
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
                project={project}
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
  project,
  submitWhitelistAllowance,
  text,
  wallet,
}: {
  language: Language
  project: LaunchProject
  submitWhitelistAllowance: (project: LaunchProject, account: string, allowance: string) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [copied, setCopied] = useState(false)
  const [whitelistAccount, setWhitelistAccount] = useState('')
  const [whitelistAllowance, setWhitelistAllowance] = useState('1')
  const [whitelistSaving, setWhitelistSaving] = useState(false)
  const progress = Math.min(100, Math.max(0, project.progress))
  const status = progress >= 100 ? text.projects.statusCompleted : project.whitelistEnabled ? text.projects.statusWhitelist : text.projects.statusMinting
  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const canManageWhitelist =
    Boolean(wallet.account) && wallet.account.toLowerCase() === project.creator.toLowerCase()
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
      <button type="button" onClick={() => window.open(explorerUrl, '_blank', 'noreferrer')}>
        <ExternalLink size={16} />
        {text.projects.viewBscScan}
      </button>
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

function SwapPage({
  connectWallet,
  text,
  wallet,
}: {
  connectWallet: () => void
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  return (
    <main className="page swap-page">
      <section className="swap-hero">
        <div>
          <p>{text.swap.eyebrow}</p>
          <h1>{text.swap.title}</h1>
          <span>{text.swap.subtitle}</span>
        </div>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.account ? shortAddress(wallet.account) : text.wallet.connect}
        </button>
      </section>
      <section className="swap-card">
        <div className="swap-head">
          <h2>{text.swap.cardTitle}</h2>
          <button type="button" title={text.swap.settings}>
            <Settings size={18} />
          </button>
        </div>
        <SwapBox label={text.swap.from} symbol="BNB" value="0.00" />
        <button className="swap-switch" type="button" aria-label={text.swap.switchDirection}>
          <ArrowDownUp size={20} />
        </button>
        <SwapBox label={text.swap.to} symbol={appSymbol} value="0.00" />
        <div className="swap-meta">
          <span>{text.swap.autoSlippage}</span>
          <span>{text.swap.deadline}</span>
        </div>
        <button className="submit-button" type="button" disabled={Boolean(wallet.account)} onClick={connectWallet}>
          {wallet.account ? text.swap.selectToken : text.wallet.connect}
        </button>
      </section>
    </main>
  )
}

function SwapBox({ label, symbol, value }: { label: string; symbol: string; value: string }) {
  return (
    <div className="swap-box">
      <span>{label}</span>
      <input value={value} readOnly />
      <button type="button">{symbol}</button>
    </div>
  )
}

function AuditorsPage({
  connectWallet,
  text,
}: {
  connectWallet: () => void
  text: (typeof copy)[Language]
}) {
  return (
    <main className="page narrow">
      <section className="auditor-grid">
        <div className="simple-panel auditor-panel">
          <div className="simple-icon">
            <ShieldCheck size={24} />
          </div>
          <h1>{text.auditors.title}</h1>
          <p>{text.auditors.desc}</p>
          <button className="submit-button" type="button" onClick={connectWallet}>
            <Wallet size={18} />
            {text.auditors.connect}
          </button>
        </div>
        <div className="queue-panel">
          <h2>{text.auditors.workflowTitle}</h2>
          {text.auditors.steps.map((item) => (
            <div className="queue-row" key={item[0]}>
              <strong>{item[0]}</strong>
              <span>{item[1]}</span>
              <em>{text.auditors.ready}</em>
            </div>
          ))}
        </div>
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
