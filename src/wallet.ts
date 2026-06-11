import { BNB_CHAIN } from './data'

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void) => void
  removeListener?: (
    event: 'accountsChanged' | 'chainChanged',
    listener: (...args: unknown[]) => void,
  ) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export const targetChainId = BNB_CHAIN.chainId.toLowerCase()

export const getProvider = () => window.ethereum

export const shortAddress = (address: string) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''

export async function requestAccounts(provider: EthereumProvider) {
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  return accounts
}

export async function getAccounts(provider: EthereumProvider) {
  const accounts = (await provider.request({
    method: 'eth_accounts',
  })) as string[]

  return accounts
}

export async function getChainId(provider: EthereumProvider) {
  return String(
    await provider.request({
      method: 'eth_chainId',
    }),
  ).toLowerCase()
}

export async function switchToBnbChain(provider: EthereumProvider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BNB_CHAIN.chainId }],
    })
  } catch (error) {
    const code = readProviderErrorCode(error)

    if (code !== 4902) {
      throw error
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [BNB_CHAIN],
    })
  }

  return getChainId(provider)
}

export function readProviderErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message)
  }

  return '钱包操作失败'
}

function readProviderErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return Number((error as { code: unknown }).code)
  }

  return 0
}
