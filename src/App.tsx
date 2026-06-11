import {
  AlertCircle,
  ArrowDownUp,
  AtSign,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
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
  Wallet,
  X,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  BNB_CHAIN,
  ZERO_ADDRESS,
  allocationMeta,
  auditorQueue,
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
  waitForTransactionReceipt,
} from './contracts/launchpad'
import type {
  AllocationKey,
  AllocationState,
  DeployState,
  FormState,
  LaunchProject,
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

type Notice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

type ProjectsStatus = 'idle' | 'loading' | 'ready' | 'error'

type ProjectFilter = 'all' | 'minting' | 'whitelist' | 'completed'

function App() {
  const [page, setPage] = useState<PageKey>(() => readPageFromHash())
  const [menuOpen, setMenuOpen] = useState(false)
  const [language, setLanguage] = useState('中文')
  const [wallet, setWallet] = useState<WalletState>({
    account: '',
    chainId: '',
    status: 'idle',
    error: '',
  })
  const [form, setForm] = useState<FormState>(initialForm)
  const [templateId, setTemplateId] = useState<TemplateId>('standard')
  const [allocation, setAllocation] = useState<AllocationState>(initialAllocation)
  const [buyTax, setBuyTax] = useState(3)
  const [sellTax, setSellTax] = useState(3)
  const [whitelistEnabled, setWhitelistEnabled] = useState(false)
  const [deployState, setDeployState] = useState<DeployState>('draft')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [projects, setProjects] = useState<LaunchProject[]>([])
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle')
  const [projectsError, setProjectsError] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectsRefreshKey, setProjectsRefreshKey] = useState(0)

  const allocationTotal = useMemo(
    () => Object.values(allocation).reduce((sum, value) => sum + value, 0),
    [allocation],
  )
  const unallocated = Math.max(0, 100 - allocationTotal)
  const onTargetNetwork = wallet.chainId.toLowerCase() === targetChainId

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

  const connectWallet = async () => {
    const provider = getProvider()

    if (!provider) {
      setWallet({
        account: '',
        chainId: '',
        status: 'missing',
        error: '未检测到浏览器钱包，请安装 MetaMask、OKX Wallet 或 TokenPocket。',
      })
      return
    }

    setWallet((current) => ({ ...current, status: 'connecting', error: '' }))

    try {
      const accounts = await requestAccounts(provider)
      const chainId = await getChainId(provider)
      const account = accounts[0] ?? ''

      if (!account) {
        throw new Error('钱包没有返回可用账号。')
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
      setWallet((current) => ({ ...current, status: 'missing', error: '未检测到浏览器钱包。' }))
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
      setNotice({ kind: 'error', message: '未检测到浏览器钱包，无法提交链上交易。' })
      return
    }

    setDeployState('pending')
    setNotice({ kind: 'info', message: '请在钱包里确认部署交易，部署费为 0.005 BNB。' })

    try {
      const result = await createLaunchToken(provider, {
        form,
        allocation,
        buyTax,
        sellTax,
        templateId,
        avatar: '',
        whitelistEnabled,
      })

      setDeployState('sent')
      setNotice({ kind: 'info', message: `部署交易已提交：${shortHash(result.hash)}，正在等待链上确认。` })

      try {
        await waitForTransactionReceipt(provider, result.hash)
        setNotice({ kind: 'success', message: '交易已确认，项目已经写入链上列表。' })
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

  const navigate = (nextPage: PageKey) => {
    window.location.hash = nextPage === 'home' ? '#/' : `#/${nextPage}`
    setPage(nextPage)
    setMenuOpen(false)
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
        setLanguage={setLanguage}
        setMenuOpen={setMenuOpen}
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
          navigate={navigate}
          projectQuery={projectQuery}
          projects={projects}
          projectsError={projectsError}
          projectsStatus={projectsStatus}
          setProjectQuery={setProjectQuery}
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
          onSubmit={submitLaunch}
          onTargetNetwork={onTargetNetwork}
          sellTax={sellTax}
          setBuyTax={setBuyTax}
          setSellTax={setSellTax}
          setTemplateId={setTemplateId}
          setWhitelistEnabled={setWhitelistEnabled}
          switchNetwork={switchNetwork}
          templateId={templateId}
          unallocated={unallocated}
          updateAllocation={updateAllocation}
          updateForm={updateForm}
          wallet={wallet}
          whitelistEnabled={whitelistEnabled}
        />
      )}
      {page === 'swap' && <SwapPage connectWallet={connectWallet} wallet={wallet} />}
      {page === 'auditors' && <AuditorsPage connectWallet={connectWallet} />}
      {page === 'verify' && (
        <SimplePanel
          button="提交验证"
          icon={<FileCode2 size={24} />}
          onClick={connectWallet}
          subtitle="部署后提交合约地址、编译版本和构造参数，跳转 BscScan 查看开源状态。"
          title="重新开源"
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
  wallet,
}: {
  activePage: PageKey
  connectWallet: () => void
  language: string
  menuOpen: boolean
  navigate: (page: PageKey) => void
  setLanguage: (value: string) => void
  setMenuOpen: (value: boolean) => void
  wallet: WalletState
}) {
  const nav = [
    { page: 'home' as PageKey, label: '返回首页', icon: <Home size={17} /> },
    { page: 'swap' as PageKey, label: 'Swap', icon: <CircleDollarSign size={17} /> },
    { page: 'auditors' as PageKey, label: '建设审核员', icon: <ShieldCheck size={17} /> },
    { page: 'verify' as PageKey, label: '重新开源', icon: <FileCode2 size={17} /> },
  ]

  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/"
        onClick={(event) => {
          event.preventDefault()
          navigate('home')
        }}
        aria-label="Apple"
      >
        <span className="brand-mark">
          <img src="/apple-logo.jpg" alt="" />
        </span>
        <span>
          <strong>Apple</strong>
          <small>{activePage === 'launch' ? 'Seed' : activePage === 'swap' ? 'Swap' : 'Launch'}</small>
        </span>
      </a>

      <button
        className="menu-button"
        type="button"
        aria-label={menuOpen ? '收起菜单' : '展开菜单'}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      <nav className={menuOpen ? 'nav is-open' : 'nav'} aria-label="主导航">
        <a href="#telegram" title="Telegram">
          <Send size={17} />
          <span>Telegram</span>
        </a>
        <a href="#x" title="X">
          <AtSign size={17} />
          <span>X</span>
        </a>
        <a href="#qq" title="QQ 群">
          <MessageCircle size={17} />
          <span>QQ 群</span>
        </a>
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
          部署代币
        </button>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.status === 'connecting' ? '连接中' : wallet.account ? shortAddress(wallet.account) : '连接钱包'}
        </button>
        <label className="language-select">
          <Languages size={16} />
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option>中文</option>
            <option>English</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </nav>
    </header>
  )
}

function HomePage({
  navigate,
  projectQuery,
  projects,
  projectsError,
  projectsStatus,
  setProjectQuery,
}: {
  navigate: (page: PageKey) => void
  projectQuery: string
  projects: LaunchProject[]
  projectsError: string
  projectsStatus: ProjectsStatus
  setProjectQuery: (value: string) => void
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
    { key: 'all', label: '链上项目' },
    { key: 'minting', label: 'Minting' },
    { key: 'whitelist', label: '白名单' },
    { key: 'completed', label: '已完成' },
  ]

  return (
    <main className="page">
      <section className="home-hero">
        <div className="hero-copy">
          <p>Apple Seed Protocol</p>
          <h1>把社区资产发射成一个完整品牌</h1>
          <span>
            创建独立 ERC20 和独立 Vault，配置 mint、税收、奖励和接收钱包。每一次发射都会写入链上，
            确认后自动出现在项目列表。
          </span>
          <div className="banner-actions">
            <button className="primary-button" type="button" onClick={() => navigate('launch')}>
              <Rocket size={18} />
              部署代币
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('swap')}>
              <ArrowDownUp size={18} />
              打开 Swap
            </button>
          </div>
        </div>

        <div className="hero-console" aria-label="发射流程预览">
          <div className="console-head">
            <span>APPLE SEED</span>
            <strong>0.005 BNB</strong>
          </div>
          <div className="console-grid">
            <div>
              <small>Token</small>
              <strong>APPLE</strong>
              <span>1,000,000,000</span>
            </div>
            <div>
              <small>Mint</small>
              <strong>2,000</strong>
              <span>0.003 BNB</span>
            </div>
            <div>
              <small>Tax</small>
              <strong>3 / 3</strong>
              <span>fund + burn</span>
            </div>
            <div>
              <small>Mode</small>
              <strong>Seed</strong>
              <span>whitelist ready</span>
            </div>
          </div>
          <div className="console-flow">
            <span>Wallet</span>
            <i />
            <span>Factory</span>
            <i />
            <span>Token + Vault</span>
          </div>
        </div>
      </section>

      <section className="feature-grid">
        <article className="feature-card">
          <p>01 发射</p>
          <h2>0.005 BNB 创建合约</h2>
          <span>连接钱包后直接发送真实部署交易；没有 Factory 地址时会阻止交易并提示配置。</span>
        </article>
        <article className="feature-card">
          <p>02 玩法</p>
          <h2>Mint + Vault 独立运行</h2>
          <span>每个项目拥有独立 ERC20 和独立铸造金库，用户 mint 后立即获得真实代币余额。</span>
        </article>
        <article className="feature-card">
          <p>03 风控</p>
          <h2>白名单和税收上链</h2>
          <span>买卖税、奖励、销毁和白名单模式随项目创建写入链上，项目方可继续管理 Vault。</span>
        </article>
      </section>

      <section className="project-board">
        <div className="board-tools">
          <label className="project-search">
            <Search size={20} />
            <input
              placeholder="输入代币名称、符号或合约地址搜索"
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
            <ProjectSkeleton />
            <ProjectSkeleton />
            <ProjectSkeleton />
          </div>
        )}

        {projectsStatus !== 'loading' && projectsError && (
          <ProjectEmptyState
            actionLabel="去部署项目"
            message={projectsError}
            title="链上项目读取失败"
            onAction={() => navigate('launch')}
          />
        )}

        {projectsStatus !== 'loading' && !projectsError && filteredProjects.length === 0 && (
          <ProjectEmptyState
            actionLabel="发布第一个项目"
            message={readProjectEmptyMessage(projects.length, normalizedQuery)}
            title={isLaunchpadConfigured ? '暂无可展示项目' : 'Factory 还未配置'}
            onAction={() => navigate('launch')}
          />
        )}

        {projectsStatus !== 'loading' && !projectsError && filteredProjects.length > 0 && (
          <div className="project-grid">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.token} project={project} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ProjectSkeleton() {
  return (
    <article className="project-card project-skeleton" aria-label="项目加载中">
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

function ProjectCard({ project }: { project: LaunchProject }) {
  const progress = Math.min(100, Math.max(0, project.progress))
  const status = progress >= 100 ? '已完成' : project.whitelistEnabled ? '白名单' : 'Minting'
  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const createdAt =
    project.createdAt > 0
      ? new Intl.DateTimeFormat('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(project.createdAt * 1000)
      : '链上项目'

  return (
    <article className="project-card">
      <div className="project-head">
        <span>{project.symbol.slice(0, 1).toUpperCase()}</span>
        <div>
          <h3>{project.name}</h3>
          <p>
            {project.symbol} · {shortAddress(project.token)} · {createdAt}
          </p>
        </div>
        <em>{status}</em>
      </div>
      <p className="project-description">{project.description}</p>
      <div className="progress-row">
        <span>铸造进度</span>
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
      <div className="project-links">
        {project.website && (
          <a href={project.website} target="_blank" rel="noreferrer" title="官网">
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
        在 BscScan 查看
      </button>
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
  onSubmit,
  onTargetNetwork,
  sellTax,
  setBuyTax,
  setSellTax,
  setTemplateId,
  setWhitelistEnabled,
  switchNetwork,
  templateId,
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onTargetNetwork: boolean
  sellTax: number
  setBuyTax: (value: number) => void
  setSellTax: (value: number) => void
  setTemplateId: (value: TemplateId) => void
  setWhitelistEnabled: (value: boolean) => void
  switchNetwork: () => void
  templateId: TemplateId
  unallocated: number
  updateAllocation: (key: AllocationKey, value: number) => void
  updateForm: <Key extends keyof FormState>(key: Key, value: FormState[Key]) => void
  wallet: WalletState
  whitelistEnabled: boolean
}) {
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? templates[0]
  const selectedPayment =
    paymentTokens.find((token) => token.address.toLowerCase() === form.paymentToken.toLowerCase()) ??
    paymentTokens[0]

  return (
    <main className="page narrow">
      <section className="status-strip">
        <div className={wallet.account ? 'status-dot ok' : 'status-dot'} />
        <div>
          <p>当前网络</p>
          <strong>{onTargetNetwork ? BNB_CHAIN.chainName : '等待切换到 BNB Smart Chain'}</strong>
          <span>
            {wallet.account
              ? `${shortAddress(wallet.account)} · Factory ${
                  isConfigured ? shortAddress(launchpadConfig.factoryAddress) : '未配置'
                }`
              : '连接钱包后会自动填入创建者接收地址'}
          </span>
        </div>
        {!onTargetNetwork && wallet.account && (
          <button type="button" onClick={switchNetwork}>
            切换网络
          </button>
        )}
      </section>

      <form className="launch-grid" onSubmit={onSubmit}>
        <div className="launch-form">
          <section className="form-section">
            <div className="section-head">
              <div>
                <p>01 基础信息</p>
                <h1>部署你的发射代币</h1>
                <span>填写品牌名称、符号、简介、付款代币、mint 价格和项目接收钱包。</span>
              </div>
              <strong>部署费 0.005 BNB</strong>
            </div>

            <div className="fields two">
              <InputField label="代币名称" value={form.tokenName} onChange={(value) => updateForm('tokenName', value)} />
              <InputField label="代币符号" value={form.symbol} onChange={(value) => updateForm('symbol', value.toUpperCase())} />
            </div>
            <label className="field">
              <span>项目介绍</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
              />
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>02 模板</p>
                <h2>选择合约模板</h2>
              </div>
              <strong>{selectedTemplate.tag}</strong>
            </div>
            <div className="template-grid">
              {templates.map((item) => (
                <button
                  className={item.id === templateId ? 'template-card active' : 'template-card'}
                  key={item.id}
                  type="button"
                  onClick={() => setTemplateId(item.id)}
                >
                  <span>{item.tag}</span>
                  <strong>{item.name}</strong>
                  <em>{item.summary}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>03 铸造参数</p>
                <h2>Mint 价格与供应</h2>
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
                  <span>{token.note}</span>
                </button>
              ))}
            </div>
            <div className="fields three">
              <InputField label="发行总量" value={form.supply} onChange={(value) => updateForm('supply', value)} />
              <InputField label="铸造次数" value={form.mintCount} onChange={(value) => updateForm('mintCount', value)} />
              <InputField label="单次价格" value={form.mintPrice} onChange={(value) => updateForm('mintPrice', value)} />
            </div>
            <label className="switch-row">
              <input
                checked={whitelistEnabled}
                type="checkbox"
                onChange={(event) => setWhitelistEnabled(event.target.checked)}
              />
              <span>
                <strong>开启白名单 Mint</strong>
                <em>开启后，只有项目方在 Vault 里设置过额度的钱包可以 mint。</em>
              </span>
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>04 税收与奖励</p>
                <h2>买卖税和分配</h2>
              </div>
              <strong>总计 {allocationTotal}%</strong>
            </div>
            <div className="tax-box">
              <SliderField label="买入税" value={buyTax} max={25} onChange={setBuyTax} />
              <SliderField label="卖出税" value={sellTax} max={25} onChange={setSellTax} />
              <div className="tax-split">
                <TaxRing allocation={allocation} />
                <div className="tax-sliders">
                  {allocationMeta.map((item) => (
                    <SliderField
                      key={item.key}
                      label={`${item.label} · ${item.hint}`}
                      max={100}
                      value={allocation[item.key]}
                      onChange={(value) => updateAllocation(item.key, value)}
                    />
                  ))}
                  <p className={allocationTotal > 100 ? 'tax-warning' : 'tax-note'}>
                    {allocationTotal > 100 ? '分配总和超过 100%，合约会拒绝部署。' : `未分配 ${unallocated}%`}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>05 链上配置</p>
                <h2>接收与奖励</h2>
              </div>
              <strong>链上记录</strong>
            </div>
            <div className="fields three">
              <InputField label="接收钱包" value={form.receiverWallet} onChange={(value) => updateForm('receiverWallet', value)} />
              <InputField
                label="奖励代币地址"
                value={form.rewardToken === ZERO_ADDRESS ? '' : form.rewardToken}
                onChange={(value) => updateForm('rewardToken', value || ZERO_ADDRESS)}
              />
              <InputField label="奖励门槛" value={form.rewardThreshold} onChange={(value) => updateForm('rewardThreshold', value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>06 可选链接</p>
                <h2>社区入口</h2>
                <span>Telegram、X 和官网会随项目简介一起保存，留空不会影响部署。</span>
              </div>
              <strong>可选</strong>
            </div>
            <div className="link-fields">
              <LinkField
                icon={<Send size={18} />}
                label="Telegram 链接"
                value={form.telegram}
                onChange={(value) => updateForm('telegram', value)}
              />
              <LinkField
                icon={<AtSign size={18} />}
                label="X 链接"
                value={form.xLink}
                onChange={(value) => updateForm('xLink', value)}
              />
              <LinkField
                icon={<Globe2 size={18} />}
                label="官网链接"
                value={form.website}
                onChange={(value) => updateForm('website', value)}
              />
            </div>
          </section>

          {!isConfigured && (
            <div className="config-warning">
              <AlertCircle size={18} />
              真实交易已经接好，但还没有配置 Factory 地址。部署合约后把地址写入 VITE_LAUNCHPAD_FACTORY_ADDRESS。
            </div>
          )}

          <button className="submit-button" type="submit" disabled={deployState === 'pending'}>
            <Rocket size={18} />
            {deployState === 'pending'
              ? '等待钱包确认'
              : !wallet.account
                ? '连接钱包'
                : !onTargetNetwork
                  ? '切换到 BNB Chain'
                  : '部署并进入链上列表'}
          </button>
        </div>

        <aside className="launch-side">
          <div className="side-orbit">
            <strong>Seed</strong>
            <span>品牌发射模式</span>
          </div>
          <div className="side-card">
            <p>当前模板</p>
            <h3>{selectedTemplate.name}</h3>
            <span>{selectedTemplate.bestFor}</span>
            <ul>
              {selectedTemplate.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
          <div className="side-card">
            <p>交易预览</p>
            <dl>
              <div>
                <dt>Factory</dt>
                <dd>{isConfigured ? shortAddress(launchpadConfig.factoryAddress) : '未配置'}</dd>
              </div>
              <div>
                <dt>部署费</dt>
                <dd>0.005 BNB</dd>
              </div>
              <div>
                <dt>付款代币</dt>
                <dd>{selectedPayment.symbol}</dd>
              </div>
              <div>
                <dt>白名单</dt>
                <dd>{whitelistEnabled ? '开启' : '关闭'}</dd>
              </div>
              <div>
                <dt>税率</dt>
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
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function LinkField({
  icon,
  label,
  onChange,
  value,
}: {
  icon: ReactNode
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="link-field">
      <span className="link-icon">{icon}</span>
      <strong>{label}</strong>
      <input placeholder="可选" value={value} onChange={(event) => onChange(event.target.value)} />
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

function TaxRing({ allocation }: { allocation: AllocationState }) {
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
        <span>总分配</span>
      </div>
      <div className="tax-ring-legend">
        {allocationMeta.map((item) => (
          <span key={item.key} style={{ '--dot-color': item.color } as CSSProperties}>
            <i />
            {item.label}
            <b>{allocation[item.key]}%</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function SwapPage({ connectWallet, wallet }: { connectWallet: () => void; wallet: WalletState }) {
  return (
    <main className="page swap-page">
      <section className="swap-hero">
        <div>
          <p>Apple Swap</p>
          <h1>为 Apple 资产预留的交易入口</h1>
          <span>代币选择、滑点设置、授权和兑换按钮已经按真实 DEX 交互预留，后续可接 Pancake Router。</span>
        </div>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.account ? shortAddress(wallet.account) : '连接钱包'}
        </button>
      </section>
      <section className="swap-card">
        <div className="swap-head">
          <h2>Swap</h2>
          <button type="button" title="设置">
            <Settings size={18} />
          </button>
        </div>
        <SwapBox label="From" symbol="BNB" value="0.00" />
        <button className="swap-switch" type="button" aria-label="切换方向">
          <ArrowDownUp size={20} />
        </button>
        <SwapBox label="To" symbol="APPLE" value="0.00" />
        <div className="swap-meta">
          <span>Auto Slippage 13%</span>
          <span>Deadline 20m</span>
        </div>
        <button className="submit-button" type="button" onClick={connectWallet}>
          {wallet.account ? '选择代币' : '连接钱包'}
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

function AuditorsPage({ connectWallet }: { connectWallet: () => void }) {
  return (
    <main className="page narrow">
      <section className="auditor-grid">
        <div className="simple-panel auditor-panel">
          <div className="simple-icon">
            <ShieldCheck size={24} />
          </div>
          <h1>建设审核员</h1>
          <p>申请成为项目审核员，记录玩法、风险和合约开源检查。</p>
          <button className="submit-button" type="button" onClick={connectWallet}>
            <Wallet size={18} />
            连接钱包
          </button>
        </div>
        <div className="queue-panel">
          <h2>审核队列</h2>
          {auditorQueue.map((item) => (
            <div className="queue-row" key={item.project}>
              <span>{item.project}</span>
              <strong>{item.score}</strong>
              <em>{item.state}</em>
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
          <Wallet size={18} />
          {button}
        </button>
      </section>
    </main>
  )
}

function readProjectEmptyMessage(projectCount: number, query: string) {
  if (!isLaunchpadConfigured) {
    return '部署 AppleLaunchFactory 后，把地址写入 VITE_LAUNCHPAD_FACTORY_ADDRESS，这里会读取真实链上项目。'
  }

  if (projectCount > 0 && query) {
    return '没有找到匹配的项目，可以换一个名称、符号或合约地址。'
  }

  if (projectCount > 0) {
    return '当前筛选条件下没有项目。'
  }

  return '暂无链上项目。有人完成发布并确认交易后，会自动出现在这里。'
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

export default App
