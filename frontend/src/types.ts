export type Band =
  | "YES_CONFIRMED_FINAL"
  | "NO_CONFIRMED_FINAL"
  | "CONDITIONAL_SCALAR_SPLIT"
  | "INVALID_OR_AMBIGUOUS_REFUND"
  | "";

export interface SettlementSnapshot {
  market_id: string;
  question: string;
  category: string;
  status: string;
  phase: string;
  mode: string;
  band: Band;
  primary_url: string;
  secondary_url: string;
  evidence_url: string;
  criteria: string;
  strike_bps: number;
  corridor_bps: number;
  observed_bps: number;
  yes_payout_bps: number;
  no_payout_bps: number;
  yes_pool: number;
  no_pool: number;
  pot: number;
  reserve_fee: number;
  distributable: number;
  yes_budget: number;
  no_budget: number;
  winning_payout: number;
  challenger_reward: number;
  yes_unclaimed: number;
  no_unclaimed: number;
  yes_paid: number;
  no_paid: number;
  refund_paid: number;
  remaining_pot: number;
  created_at: number;
  close_epoch: number;
  resolution_epoch: number;
  challenge_deadline_epoch: number;
  resolution_timeout_epoch: number;
  now: number;
  corroborated: boolean;
  zero_winners: boolean;
  refundable: boolean;
  challenge_count: number;
  pending_challenge: string;
  summary: string;
  digest: string;
  can_trade: boolean;
  can_resolve: boolean;
  can_challenge: boolean;
  can_audit: boolean;
  can_finalize: boolean;
  can_claim: boolean;
  can_refund: boolean;
}

export interface PlatformStats {
  token_symbol: string;
  token_name: string;
  total_markets: number;
  open_markets: number;
  provisional_markets: number;
  challenged_markets: number;
  finalized_markets: number;
  refunded_markets: number;
  total_volume: number;
  total_paid_out: number;
  total_refunded: number;
  settlement_count: number;
  tvl: number;
  total_supply: number;
  native_custody_wei: number;
  protocol_reserve: number;
  epoch: number;
  invariant_ok: boolean;
  privileged_roles: number;
  grid_step_bps: number;
  fee_bps: number;
  reward_bps: number;
  max_challenges: number;
  min_challenge_bond_wei: number;
  hedge_reservations: number;
}

export interface PositionRow {
  market_id: string;
  yes_shares: number;
  no_shares: number;
  principal: number;
  estimated_payout: number;
  refund_amount: number;
  implied_yes_bps: number;
  phase: string;
  status: string;
  band: Band;
  can_claim: boolean;
}

export interface HedgeRow {
  hedge_id: string;
  account: string;
  primary_market_id: string;
  hedge_market_id: string;
  primary_side: "YES" | "NO";
  hedge_side: "YES" | "NO";
  collateral: number;
  reservation: number;
  state: string;
  opened_at: number;
  released_at: number;
  paid: number;
  weights_bps: number;
  unlock_epoch: number;
  primary_weight_bps: number;
  hedge_weight_bps: number;
  digest: string;
}

export interface DeskBook {
  account: string;
  balance_pgt: number;
  refundable_wei: number;
  last_rejection: string;
  positions: PositionRow[];
  hedges: HedgeRow[];
}

export interface ResolutionReceipt {
  market_id: string;
  band: Band;
  quantized_strike_baseline_bps: number;
  quantized_observed_metric_bps: number;
  yes_payout_bps: number;
  no_payout_bps: number;
  derived_winning_pool_payout: number;
  derived_challenger_reward: number;
  derived_protocol_reserve_fee: number;
  dual_source_corroborated: boolean;
  summary: string;
  primary_url: string;
  secondary_url: string;
  evidence_url: string;
  resolution_epoch: number;
  challenge_deadline_epoch: number;
  resolution_timeout_epoch: number;
  digest: string;
  principle: string;
  grid_step_bps: number;
  compared_fields: string[];
  challenges: Array<{
    key: string;
    challenger: string;
    state: string;
    bond: number;
    filed_at: number;
    decided_at: number;
    prior_band: string;
    counter_url: string;
  }>;
}

export interface CustodyReport {
  vault_custody_balance: number;
  custody_terms_total: number;
  locked_market_pots: number;
  pending_challenge_bonds: number;
  hedge_reservations: number;
  protocol_reserve: number;
  refundable_native: number;
  wallet_balances: number;
  total_supply: number;
  native_custody_balance: number;
  ok: boolean;
  rule?: string;
  token_symbol?: string;
  soft_fail_count?: number;
}

export interface EcosystemFeed {
  feed: string;
  settlement: SettlementSnapshot;
  receipt: ResolutionReceipt;
  custody: CustodyReport;
  consumers: Array<{
    address: string;
    name: string;
    read_count: number;
    last_market_id: string;
  }>;
  hedges_on_market: HedgeRow[];
}

export interface ConsensusPolicy {
  principle: string;
  compared_fields: string[];
  bands: string[];
  grid_step_bps: number;
  fee_bps: number;
  reward_bps: number;
  min_window_seconds: number;
  max_close_window_seconds: number;
  max_challenge_window_seconds: number;
  max_timeout_margin_seconds: number;
  max_challenges_per_market: number;
  sanitizer: string;
}

export interface MarketPage {
  rows: SettlementSnapshot[];
  total: number;
  offset: number;
}

export interface TxBinding {
  id: number;
  label: string;
  hash: string;
  execution: string | null;
  status: string | null;
  at: number;
}
