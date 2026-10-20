# Contract adversarial review

Review of `contracts/prophet_grid.py` at commit `4a0b51f`, deployed as
`0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967` on studionet.

## State machine

| Status | Who may act | Method | Next status | Funds |
|---|---|---|---|---|
| (none) | anyone | `create_market` | OPEN | none |
| OPEN | anyone with balance | `buy_outcome_shares` | OPEN | wallet to vault, pool credited |
| OPEN | anyone | `resolve_market_live` | PROVISIONAL | unchanged, pot locked |
| PROVISIONAL | anyone with bond | `file_resolution_challenge` | CHALLENGED | bond wallet to vault |
| PROVISIONAL | anyone | `finalize_market_settlement` when `clock >= deadline` | FINALIZED | unchanged, claims open |
| CHALLENGED | anyone | `audit_resolution_challenge` | PROVISIONAL | upheld: bond to market pot; overturned: bond to challenger |
| CHALLENGED | anyone | `finalize_market_settlement` after `deadline + window` | FINALIZED | bond returned, market becomes a principal refund |
| FINALIZED | position holder | `claim_market_payout` | FINALIZED | vault to wallet, receipt written |
| any | anyone | `advance_market_clock`, `faucet_or_deposit`, `transfer_tokens` | unchanged | mint or wallet to wallet |

No status has an owner-only transition. There is no owner field in storage.

## 1. Liveness

| Locked state | Escape | Verdict |
|---|---|---|
| OPEN with positions | anyone calls `resolve_market_live` | OPEN finding C |
| PROVISIONAL | anyone finalizes after the deadline | safe |
| CHALLENGED | anyone audits, or after the grace window anyone finalizes as a refund | safe |
| FINALIZED | each holder claims its own share | safe |
| FINALIZED with zero winning shares | none | OPEN finding B |

Deadlines use the on chain logical clock only. `file_resolution_challenge`
requires `clock < deadline`, `claim_market_payout` requires `clock >= deadline`,
so the two guards are mutually exclusive at the boundary.

## 2. Races

- buy versus resolve, buy versus challenge: both require OPEN or PROVISIONAL and
  the first transaction changes the status, so the second reverts.
- challenge versus finalize: separated by the deadline comparison.
- audit versus finalize: both require CHALLENGED, and the first one changes the
  status, so a bond can only be refunded once.
- double claim: the receipt key is written in the same transaction that pays.
- two challenge filings: the second sees CHALLENGED and reverts.
- transfer versus claim: different balances and buckets.

## 3. Accounting

Invariant: `vault_custody_balance == sum(remaining market pots) + sum(pending bonds)`.
Exposed by `check_vault_invariants()`. Asserted after every transition in
`test_vault_invariants_hold_after_every_transition` and again on chain after the
scenario (`vault 800 == pots 800 + bonds 0`).

Rounding: `test_dust_is_conserved_to_the_last_claimant` proves the last claimant
absorbs the remainder and the sum equals the pot. Refunds:
`test_invalid_refund_returns_full_principal` proves 100 percent principal, and
`test_refund_with_forfeit_pot_scales_pro_rata` proves pro rata scaling with a
forfeited bond.

## 4. Input validation

Length caps on question and criteria, category allow list, URL scheme, host,
credential and private range checks, amount floors and ceilings, clock step
bounds, market cap, challenge cap, zero and self transfer rejection. Each has a
negative test.

## 5. Consensus

The payout is driven by a three value label set, never by a free form model
number. The model returns a stance and a confidence, the confidence is quantized
with integer math to five anchors, and the band is derived deterministically.
Validators re-fetch both sources and must agree exactly on the three fields.
Direct tests exercise the leader path only. Live studionet transactions prove
validator behaviour: three `MAJORITY_AGREE` resolutions, one observed
`MAJORITY_DISAGREE` that correctly wrote no state.

Prompt injection: markup and instruction text inside evidence are defused and
stripped before the prompt. `test_prompt_injection_markup_is_stripped` proves the
raw closing tag and braces never reach the prompt. This is tested sanitization,
not a proof of injection immunity.

## Findings

### FIXED

| Finding | Proof |
|---|---|
| Owner or creator resolution bypass | `test_no_deterministic_resolution_entrypoints`, `test_access_model_declares_no_privileged_role` |
| Premature claim before the window closes | `test_claim_before_window_close_reverts`, on chain `guard:premature_claim` |
| Claim while a re-audit is pending | `test_claim_while_challenge_pending_reverts` |
| Double claim | `test_claim_twice_reverts`, on chain `guard:double_claim` |
| Losing side or zero share claim | `test_losing_side_claim_reverts`, `test_zero_share_claim_reverts` |
| Rounding loss in payouts | `test_dust_is_conserved_to_the_last_claimant` |
| Malformed or ambiguous model output settles a market | `test_malformed_json_fails_closed`, `test_missing_confidence_fails_closed`, `test_confidence_out_of_range_fails_closed` |
| Unauthenticated evidence pays a side | `test_unauthenticated_source_refunds` |
| Prompt markup reaches the model | `test_prompt_injection_markup_is_stripped` |
| Challenge bond double refund | `test_audit_overturned_refunds_the_bond`, status guard on audit |

### OPEN

**A. The permissionless clock can close a challenge window early.**
`advance_market_clock` accepts up to 1000 steps from any caller. A griefer can
advance the clock right after a resolution and deny the challenge opportunity.
The verdict itself cannot be changed this way and no funds are stolen, because
the verdict is already consensus derived. Severity: medium. Fix for a future
deployment: cap the clock at one step per transaction, or bind the window to a
per market counter that only a resolution can advance.

**B. A winning side with zero shares leaves the pot locked.**
A market where every trader bought NO can still resolve YES. At finalize,
`unclaimed_winner_shares` becomes 0, the losing side has no claim, and the pot
stays in the vault with no owner. Severity: medium, no theft. Fix: at finalize,
if the winning pool is zero, set `OUTCOME_INVALID_REFUND` and refund principal.

**C. An OPEN market has no liveness valve.**
If consensus never produces a verdict, a funded market stays OPEN forever. The
stalled valve only covers a challenge. Severity: medium, no theft. Fix: allow a
permissionless, refund only conversion to `OUTCOME_INVALID_REFUND` after a large
number of clock steps, with no winner selection.

**D. Direct mode tests do not exercise validators.**
They run the leader only. Validator agreement is covered by the live studionet
transactions in `evidence/studionet_deployment.json`, including one observed
disagreement that wrote no state.

None of the open findings allow a payout to the wrong party. They are liveness
and griefing issues, documented in the README limitations with the remediation
path for a next deployment.
