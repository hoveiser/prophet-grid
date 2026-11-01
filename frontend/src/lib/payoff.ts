import { FEE_BPS, FULL_SCALE_BPS, GRID_STEP_BPS, REWARD_BPS } from "../config";

export function snapGrid(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > FULL_SCALE_BPS) return -1;
  const stepped = Math.round(value / GRID_STEP_BPS) * GRID_STEP_BPS;
  return Math.min(FULL_SCALE_BPS, stepped);
}

export interface Corridor {
  lower: number;
  upper: number;
}

export function corridorFor(strike: number, corridor: number): Corridor {
  const step = Math.max(GRID_STEP_BPS, Math.min(FULL_SCALE_BPS, corridor));
  return {
    lower: Math.max(0, strike - step),
    upper: Math.min(FULL_SCALE_BPS, strike + step),
  };
}

export type ModeledBand =
  | "YES_CONFIRMED_FINAL"
  | "NO_CONFIRMED_FINAL"
  | "CONDITIONAL_SCALAR_SPLIT"
  | "INVALID_OR_AMBIGUOUS_REFUND";

export interface BandResult {
  band: ModeledBand;
  yes_payout_bps: number;
  no_payout_bps: number;
}

/** Mirror of the on chain decision rule, used only for desk modelling. */
export function decideBand(observed: number, strike: number, corridor: number, corroborated: boolean): BandResult {
  const { lower, upper } = corridorFor(strike, corridor);
  if (!corroborated) {
    return { band: "INVALID_OR_AMBIGUOUS_REFUND", yes_payout_bps: 0, no_payout_bps: 0 };
  }
  if (observed >= upper) {
    return { band: "YES_CONFIRMED_FINAL", yes_payout_bps: FULL_SCALE_BPS, no_payout_bps: 0 };
  }
  if (observed < lower) {
    return { band: "NO_CONFIRMED_FINAL", yes_payout_bps: 0, no_payout_bps: FULL_SCALE_BPS };
  }
  const span = upper - lower;
  let yes = span <= 0 ? FULL_SCALE_BPS / 2 : snapGrid(((observed - lower) * FULL_SCALE_BPS) / span);
  yes = Math.max(GRID_STEP_BPS, Math.min(FULL_SCALE_BPS - GRID_STEP_BPS, yes));
  return { band: "CONDITIONAL_SCALAR_SPLIT", yes_payout_bps: yes, no_payout_bps: FULL_SCALE_BPS - yes };
}

export interface PayoffInput {
  yesPool: number;
  noPool: number;
  deskYes: number;
  deskNo: number;
  strike: number;
  corridor: number;
  observed: number;
  corroborated: boolean;
}

export interface PayoffResult extends BandResult {
  pot: number;
  fee: number;
  distributable: number;
  yesBudget: number;
  noBudget: number;
  deskPayout: number;
  deskPrincipal: number;
  roiBps: number;
  dust: number;
  conserved: boolean;
  refundMode: boolean;
}

/** Full book payoff including the fee sink and the exact conservation check. */
export function modelPayoff(input: PayoffInput): PayoffResult {
  const yesPool = Math.max(0, Math.floor(input.yesPool));
  const noPool = Math.max(0, Math.floor(input.noPool));
  const pot = yesPool + noPool;
  const fee = Math.floor((pot * FEE_BPS) / FULL_SCALE_BPS);
  const distributable = pot - fee;
  const outcome = decideBand(
    snapGrid(input.observed),
    snapGrid(input.strike),
    input.corridor,
    input.corroborated,
  );
  const yesBudget = Math.floor((distributable * outcome.yes_payout_bps) / FULL_SCALE_BPS);
  const noBudget = distributable - yesBudget;
  const deskYes = Math.min(Math.max(0, Math.floor(input.deskYes)), yesPool);
  const deskNo = Math.min(Math.max(0, Math.floor(input.deskNo)), noPool);
  const yesShare = yesPool > 0 ? Math.floor((yesBudget * deskYes) / yesPool) : 0;
  const noShare = noPool > 0 ? Math.floor((noBudget * deskNo) / noPool) : 0;
  const refundMode = outcome.band === "INVALID_OR_AMBIGUOUS_REFUND" || (yesPool === 0 && noPool === 0);
  const deskPayout = refundMode ? deskYes + deskNo : yesShare + noShare;
  const principal = deskYes + deskNo;
  return {
    ...outcome,
    pot,
    fee,
    distributable,
    yesBudget,
    noBudget,
    deskPayout,
    deskPrincipal: principal,
    roiBps: principal > 0 ? Math.floor(((deskPayout - principal) * FULL_SCALE_BPS) / principal) : 0,
    dust: distributable - yesBudget - noBudget,
    conserved: yesBudget + noBudget === distributable && deskPayout <= distributable + fee,
    refundMode,
  };
}

/** Hedge basket payoff: the better weighted leg, capped by the collateral. */
export function modelHedge(collateral: number, primaryWeight: number, hedgeWeight: number, headroom: number) {
  const payoff = Math.floor((collateral * (primaryWeight + hedgeWeight)) / (2 * FULL_SCALE_BPS));
  const reservation = collateral + headroom;
  return {
    payoff,
    reservation,
    change: reservation - collateral,
    credit: payoff + reservation - collateral,
    shortfall: collateral - payoff,
    withinReserve: payoff + reservation - collateral <= reservation,
  };
}

export function rewardFor(pot: number, reserve: number): number {
  return Math.min(Math.floor((pot * REWARD_BPS) / FULL_SCALE_BPS), reserve);
}
