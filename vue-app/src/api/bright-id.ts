import { Contract, Signer } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { formatBytes32String } from '@ethersproject/strings'

import { BrightIdUserRegistry } from './abi'
import { provider } from './core'

const NODE_URL = 'https://app.brightid.org/node/v5'

export interface BrightId {
  isLinked: boolean
  isSponsored: boolean
  isVerified: boolean // If is verified in BrightID
}

export async function isSponsoredUser(
  registryAddress: string,
  userAddress: string
): Promise<boolean> {
  const registry = new Contract(registryAddress, BrightIdUserRegistry, provider)
  const eventFilter = registry.filters.Sponsor(userAddress)
  const events = await registry.queryFilter(eventFilter, 0)
  return events.length > 0
}

export async function selfSponsor(
  registryAddress: string,
  signer: Signer
): Promise<TransactionResponse> {
  const registry = new Contract(registryAddress, BrightIdUserRegistry, signer)
  const userAddress = await signer.getAddress()
  const transaction = await registry.sponsor(userAddress)
  return transaction
}

export function getBrightIdLink(userAddress: string): string {
  const nodeUrl = 'http:%2f%2fnode.brightid.org'
  const deepLink = `brightid://link-verification/${nodeUrl}/${process.env.VUE_APP_BRIGHTID_CONTEXT}/${userAddress}`
  return deepLink
}

export interface Verification {
  unique: boolean
  contextIds: string[]
  sig: { r: string; s: string; v: number }
  timestamp: number
}

export class BrightIdError extends Error {
  code?: number

  constructor(code?: number) {
    const message = code ? `BrightID error ${code}` : 'Unexpected error'
    super(message)
    // https://github.com/Microsoft/TypeScript/issues/13965#issuecomment-388605613
    Object.setPrototypeOf(this, BrightIdError.prototype)
    this.code = code
  }
}

export async function getVerification(
  userAddress: string
): Promise<Verification | null> {
  const apiUrl = `${NODE_URL}/verifications/${process.env.VUE_APP_BRIGHTID_CONTEXT}/${userAddress}?signed=eth&timestamp=seconds`
  const response = await fetch(apiUrl)
  const data = await response.json()
  if (data['error']) {
    throw new BrightIdError(data['errorNum'])
  } else {
    return data['data']['unique'] ? data['data'] : null
  }
}

export async function registerUser(
  registryAddress: string,
  verification: Verification,
  signer: Signer
): Promise<TransactionResponse> {
  const registry = new Contract(registryAddress, BrightIdUserRegistry, signer)
  const transaction = await registry.register(
    formatBytes32String(process.env.VUE_APP_BRIGHTID_CONTEXT || ''),
    verification.contextIds,
    verification.timestamp,
    verification.sig.v,
    '0x' + verification.sig.r,
    '0x' + verification.sig.s
  )
  return transaction
}

export async function getBrightId(contextId: string): Promise<BrightId> {
  const brightId: BrightId = {
    isLinked: false,
    isSponsored: false,
    isVerified: false,
  }

  try {
    const verification = await getVerification(contextId)
    brightId.isLinked = true
    brightId.isSponsored = true
    brightId.isVerified = !!verification?.unique
  } catch (error) {
    if (!(error instanceof BrightIdError)) {
      /* eslint-disable-next-line no-console */
      console.error(error)
    }

    // Not verified user
    if (error.code === 3) {
      brightId.isLinked = true
      brightId.isSponsored = true
    }

    // Not sponsored user
    if (error.code === 4) {
      brightId.isLinked = true
    }
  }

  return brightId
}
