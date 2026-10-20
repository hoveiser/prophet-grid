export type OutcomeBand = "OUTCOME_YES" | "OUTCOME_NO" | "OUTCOME_INVALID_REFUND" | "";
export type MarketStatus = "OPEN" | "PROVISIONAL" | "CHALLENGED" | "FINALIZED";
export type MarketPhase =
  | "TRADING"
  | "CHALLENGE_WINDOW"
  | "READY_TO_FINALIZE"
  | "REAUDIT_PENDING"
  | "SETTLED";

export interface PlatformStats {
  token_symbol: string;
  token_name: string;
  total_markets: number;
  open_markets: number;
  provisional_markets: number;
  challenged_markets: number;
  finalized_markets: number;
  total_volume: number;
  total_pot_locked: number;
  total_paid_out: number;
  tvl: number;
  total_supply: number;
  clock_step: number;
  challenge_window_steps: number;
  challenge_bond_amount: number;
  runner_pin: string;
  invariant_ok: boolean;
  active_challenge_bonds: number;
  privileged_roles: number;
}

export interface Market {
  market_id: number;
  question: string;
  category: string;
  primary_source_url: string;
  resolution_criteria: string;
  status: MarketStatus;
  phase: MarketPhase;
  yes_pool: number;
  no_pool: number;
  forfeit_pot: number;
  total_pot: number;
  remaining_liability: number;
  paid_out: number;
  provisional_outcome: OutcomeBand;
  confidence_anchor: number;
  source_authenticated: boolean;
  resolution_summary: string;
  evidence_url: string;
  evidence_digest: string;
  resolved_at_step: number;
  challenge_deadline_step: number;
  challenge_open: boolean;
  challenge_count: number;
  challenge_bond_locked: number;
  countdown_steps: number;
  settlement_ready: boolean;
  claimable_now: boolean;
  claim_block_reason: string;
  implied_yes_prob_bps: number;
  payout_multiple_ppm: number;
  winning_side: string;
  winning_pool: number;
  principal_pool: number;
  unclaimed_winner_shares: number;
  unclaimed_refund_principal: number;
  trade_count: number;
  created_at_step: number;
  finalized_at_step: number;
  clock_step: number;
}

export interface MarketPage {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  clock_step: number;
  markets: Market[];
}

export interface Position {
  market_id: number;
  question: string;
  status: MarketStatus;
  phase: MarketPhase;
  outcome_band: OutcomeBand;
  yes_shares: number;
  no_shares: number;
  principal: number;
  claimable: boolean;
  payout_quote: number;
  claimed: boolean;
  claim_block_reason: string;
}

export interface Portfolio {
  trader: string;
  balance: number;
  position_count: number;
  positions: Position[];
  clock_step: number;
}

export interface ChallengeView {
  index: number;
  challenger: string;
  bond: number;
  status: string;
  filed_at_step: number;
  reviewed_at_step: number;
  original_outcome: string;
  final_outcome: string;
  counter_evidence_url: string;
}

export interface ResolutionReceipt {
  market_id: number;
  question: string;
  status: MarketStatus;
  phase: MarketPhase;
  outcome_band: OutcomeBand;
  confidence_anchor: number;
  source_authenticated: boolean;
  summary: string;
  primary_source_url: string;
  evidence_url: string;
  evidence_digest: string;
  resolved_at_step: number;
  challenge_deadline_step: number;
  challenge_open: boolean;
  countdown_steps: number;
  challenges: ChallengeView[];
  consensus: string;
  principle: string;
  sanitizer_rules: string;
  parse_policy: string;
  error_taxonomy: string;
  confidence_anchors: number[];
  resolve_threshold: number;
  document_char_limit: number;
  runner_pin: string;
  evidence_sources: string[];
  challenge_window_steps: number;
  challenge_bond_amount: number;
}

export interface PayoutReceipt {
  exists: boolean;
  market_id: number;
  holder: string;
  outcome_band?: OutcomeBand;
  shares?: number;
  principal?: number;
  payout?: number;
  claimed_at_step?: number;
  digest?: string;
}

export interface TxRecord {
  hash: string;
  functionName: string;
  status: "pending" | "accepted" | "error";
  message?: string;
  at: number;
}
