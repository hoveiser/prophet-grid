export type OutcomeBand = "OUTCOME_YES" | "OUTCOME_NO" | "OUTCOME_INVALID_REFUND" | "";
export type MarketStatus = "OPEN" | "CHALLENGE_WINDOW" | "FINALIZED" | "REFUNDABLE_ZERO_WINNERS" | "EXPIRED";
export type MarketPhase =
  | "TRADING"
  | "CLOSED_WAITING_RESOLUTION"
  | "CHALLENGE_WINDOW"
  | "READY_TO_FINALIZE"
  | "SETTLED"
  | "ZERO_WINNER_REFUND"
  | "EXPIRED_REFUND";

export interface PlatformStats {
  token_symbol: string;
  token_name: string;
  total_markets: number;
  open_markets: number;
  challenge_window_markets: number;
  finalized_markets: number;
  refundable_zero_winner_markets: number;
  expired_markets: number;
  total_volume: number;
  total_pot_locked: number;
  total_paid_out: number;
  tvl: number;
  total_supply: number;
  current_epoch: number;
  epoch_seconds: number;
  challenge_window_epochs: number;
  resolution_grace_epochs: number;
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
  close_epoch: number;
  resolution_timeout_epoch: number;
  resolved_at_epoch: number;
  challenge_deadline_epoch: number;
  challenge_open: boolean;
  challenge_count: number;
  countdown_epochs: number;
  trading_open: boolean;
  expiry_ready: boolean;
  settlement_ready: boolean;
  claimable_now: boolean;
  refund_claimable: boolean;
  claim_block_reason: string;
  implied_yes_prob_bps: number;
  payout_multiple_ppm: number;
  winning_side: string;
  winning_pool: number;
  principal_pool: number;
  unclaimed_winner_shares: number;
  unclaimed_refund_principal: number;
  trade_count: number;
  created_at_epoch: number;
  finalized_at_epoch: number;
  current_epoch: number;
}

export interface MarketPage {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  current_epoch: number;
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
  claim_path: string;
  payout_quote: number;
  claimed: boolean;
  claim_block_reason: string;
}

export interface Portfolio {
  trader: string;
  balance: number;
  position_count: number;
  positions: Position[];
  current_epoch: number;
}

export interface ChallengeView {
  index: number;
  challenger: string;
  bond: number;
  status: string;
  filed_at_epoch: number;
  reviewed_at_epoch: number;
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
  resolved_at_epoch: number;
  close_epoch: number;
  resolution_timeout_epoch: number;
  challenge_deadline_epoch: number;
  challenge_open: boolean;
  countdown_epochs: number;
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
  challenge_window_epochs: number;
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
  claimed_at_epoch?: number;
  digest?: string;
}

export interface TxRecord {
  hash: string;
  functionName: string;
  status: "pending" | "accepted" | "error";
  message?: string;
  at: number;
}
