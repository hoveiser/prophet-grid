import type { OutcomeBand } from "../types";

export interface SimInput {
  yesPool: number;
  noPool: number;
  stake: number;
  side: "YES" | "NO";
  band: OutcomeBand;
}

export interface SimResult {
  band: OutcomeBand;
  totalPot: number;
  winningPool: number;
  shares: number;
  payout: number;
  otherPayouts: number;
  dustToLastClaimant: number;
  conservationOk: boolean;
  roiBps: number;
  impliedYesBps: number;
  payoutMultiplePpm: number;
  principal: number;
  lossIfWrong: number;
}

function safe(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function simulate(input: SimInput): SimResult {
  const yesPool = safe(input.yesPool);
  const noPool = safe(input.noPool);
  const stake = safe(input.stake);
  const band: OutcomeBand = input.band || "OUTCOME_INVALID_REFUND";

  const yesAfter = yesPool + (input.side === "YES" ? stake : 0);
  const noAfter = noPool + (input.side === "NO" ? stake : 0);
  const totalPot = yesAfter + noAfter;
  const principalPool = totalPot;
  const impliedYesBps = principalPool > 0 ? Math.round((yesAfter * 10000) / principalPool) : 0;

  let winningPool = 0;
  let shares = 0;
  if (band === "OUTCOME_INVALID_REFUND") {
    winningPool = principalPool;
    shares = stake;
  } else if (band === "OUTCOME_YES") {
    winningPool = yesAfter;
    shares = input.side === "YES" ? stake : 0;
  } else {
    winningPool = noAfter;
    shares = input.side === "NO" ? stake : 0;
  }

  let payout = 0;
  let otherPayouts = 0;
  if (winningPool > 0 && shares > 0) {
    payout = Math.floor((shares * totalPot) / winningPool);
    otherPayouts = Math.floor(((winningPool - shares) * totalPot) / winningPool);
  } else if (winningPool > 0) {
    otherPayouts = Math.floor((winningPool * totalPot) / winningPool);
  }

  const dustToLastClaimant = Math.max(0, totalPot - payout - otherPayouts);
  const conservationOk = payout + otherPayouts + dustToLastClaimant === totalPot;
  const roiBps = stake > 0 ? Math.round(((payout - stake) * 10000) / stake) : 0;
  const payoutMultiplePpm = winningPool > 0 ? Math.round((totalPot * 1_000_000) / winningPool) : 0;

  return {
    band,
    totalPot,
    winningPool,
    shares,
    payout,
    otherPayouts,
    dustToLastClaimant,
    conservationOk,
    roiBps,
    impliedYesBps,
    payoutMultiplePpm,
    principal: stake,
    lossIfWrong: shares === 0 ? stake : 0,
  };
}

export function boundaryPreview(input: SimInput): SimResult[] {
  return (["OUTCOME_YES", "OUTCOME_NO", "OUTCOME_INVALID_REFUND"] as OutcomeBand[]).map((band) =>
    simulate({ ...input, band }),
  );
}
