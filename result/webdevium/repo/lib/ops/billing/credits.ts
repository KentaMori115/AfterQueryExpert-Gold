/**
 * A prepaid balance a client can spend against a settled cycle. The money is
 * already in hand, so a balance is worth using before it lapses rather than
 * after.
 */
export type SettlementCredit = {
  id: string
  remainingCents: number
  expiresAt: number | null
}

/** One draw against one balance, in the currency the client is billed in. */
export type CreditApplication = {
  creditId: string
  cents: number
}

export type CreditOutcome = {
  applications: CreditApplication[]
  appliedCents: number
  owedCents: number
  credits: SettlementCredit[]
}

/**
 * A balance is spendable while it still has money on it and has not lapsed by
 * the time the cycle closes. A balance with no expiry never lapses, which is
 * why it waits: it will still be there next month.
 */
export function creditIsLive(credit: SettlementCredit, closesAt: number) {
  if (credit.remainingCents <= 0) return false
  return credit.expiresAt === null || credit.expiresAt >= closesAt
}

function lapseRank(a: SettlementCredit, b: SettlementCredit) {
  const left = a.expiresAt
  const right = b.expiresAt
  if (left === null && right !== null) return 1
  if (right === null && left !== null) return -1
  if (left !== null && right !== null && left !== right) return left - right
  return 0
}

/**
 * Spend what lapses soonest first, so a client never loses money it could
 * have used. Two balances that lapse together are separated by size and then
 * by id, which keeps a statement reproducible whatever order the caller
 * happened to hand the balances over in.
 */
export function creditOrder(a: SettlementCredit, b: SettlementCredit) {
  const byLapse = lapseRank(a, b)
  if (byLapse !== 0) return byLapse
  if (a.remainingCents !== b.remainingCents) {
    return a.remainingCents - b.remainingCents
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The spendable balances, in the order they should be drawn down. */
export function orderCredits(credits: SettlementCredit[], closesAt: number) {
  return credits.filter((credit) => creditIsLive(credit, closesAt)).sort(creditOrder)
}

/**
 * A working copy of the balances, keyed by id. The caller's rows are never
 * touched: a statement is a reading of the books, not a write to them, and a
 * caller that settles the same cycle twice should get the same answer.
 */
export function openLedger(credits: SettlementCredit[]) {
  const ledger = new Map<string, SettlementCredit>()
  for (const credit of credits) {
    ledger.set(credit.id, { ...credit })
  }
  return ledger
}

/**
 * What a single balance can put toward the bill: never more than it holds,
 * and never more than is left owing.
 */
function takeFrom(credit: SettlementCredit, owed: number) {
  const spend = Math.min(credit.remainingCents, owed)
  return spend > 0 ? spend : 0
}

/**
 * Draw balances down against what is still owed. Nothing is spent once the
 * bill reaches zero and no balance ever goes past its own remainder, so a
 * cycle can close with money still on the books. Every balance the caller
 * passed comes back, spent or not, in the order it arrived: a caller that
 * stores these rows by position should not have to re-key them.
 */
export function applyCredits(
  owedCents: number,
  credits: SettlementCredit[],
  closesAt: number
): CreditOutcome {
  const ledger = openLedger(credits)
  const applications: CreditApplication[] = []
  let owed = Math.max(0, owedCents)
  let applied = 0

  for (const candidate of orderCredits([...ledger.values()], closesAt)) {
    if (owed <= 0) break
    const held = ledger.get(candidate.id)
    if (!held) continue
    const spend = takeFrom(held, owed)
    if (spend === 0) continue
    held.remainingCents -= spend
    owed -= spend
    applied += spend
    applications.push({ creditId: held.id, cents: spend })
  }

  return {
    applications,
    appliedCents: applied,
    owedCents: owed,
    credits: credits.map((credit) => ledger.get(credit.id) ?? { ...credit }),
  }
}
