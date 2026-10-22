# Contract adversarial review

Review of `contracts/prophet_grid.py` (v2, Steward remediation), deployed as
`0x5d7776fc51b76DF271f232A56e2E76F3e2d0fcE8` on studionet. Tag
`studionet-v2-remediated`.

The builder program steward rejected the previous version because "any caller
can resolve a market before an objective deadline and immediately advance the
logical clock past its challenge window, while zero-winner and unresolved
markets can permanently lock funds". Every clause is closed here, with a direct
test and an on chain probe for each.

## Time model

There is no stored clock. One epoch is 60 seconds of deterministic block time,
and `current_epoch` is derived inside every call from the transaction
datetime. `close_epoch` and `resolution_timeout_epoch` are frozen at creation;
`challenge_deadline_epoch` is frozen at proposal and is the only value a
successful challenge may move, forward, never backward. `advance_market_clock`
is a tombstone that reverts unconditionally. Compression of any window would
require fewer real blocks to have been produced, which is a consensus layer
property, not a caller input.

## State machine

| Status | Who may act | Method | Next status | Funds |
|---|---|---|---|---|
| (none) | anyone | `create_market` | OPEN | none |
| OPEN, `now < close_epoch` | anyone with balance | `buy_outcome_shares` | OPEN | wallet to vault, pool credited |
| OPEN, `close_epoch <= now < timeout` | anyone | `propose_resolution` | CHALLENGE_WINDOW | unchanged, pot locked |
| OPEN, `now >= resolution_timeout_epoch` | any participant | `expire_unresolved_market` | EXPIRED | nothing moves, refund bucket armed |
| CHALLENGE_WINDOW, `now <= deadline`, count < 2 | anyone with bond | `challenge_resolution` | CHALLENGE_WINDOW, deadline restarts | upheld: bond debited to forfeit pot in the same tx; overturned: bond kept, verdict replaced |
| CHALLENGE_WINDOW, `now > deadline` | anyone | `finalize_market` | FINALIZED, or REFUNDABLE_ZERO_WINNERS when the winning pool is 0 | unchanged, claims or refunds open |
| FINALIZED | position holder | `claim_market_payout` | FINALIZED | vault to wallet, receipt written |
| REFUNDABLE_ZERO_WINNERS or EXPIRED | position holder | `claim_refund` | unchanged | 100 percent principal, vault to wallet, receipt written |
| any | anyone | `faucet_or_deposit`, `transfer_tokens` | unchanged | mint or wallet to wallet |
| any | anyone | `advance_market_clock` | reverts | none |

No status has an owner-only transition. There is no owner field in storage.

## Steward clause coverage

| Clause | Closure | Direct test | On chain probe |
|---|---|---|---|
| Resolution before an objective deadline | `propose_resolution` requires `now >= close_epoch` | `test_propose_before_close_reverts` | `guard:early_resolution` |
| Clock fast forward past the window | clock deleted, tombstone reverts, epochs are block time | `test_clock_manipulation_always_reverts`, `test_epochs_only_move_with_real_block_time` | `guard:advance_clock` |
| Finalize or claim inside the window | `finalize_market` requires `now > challenge_deadline_epoch`; claims require FINALIZED | `test_finalize_before_window_elapses_reverts`, `test_claim_before_window_close_reverts` | `guard:early_finalize`, `guard:early_claim` |
| Challenge restarts the window | deadline moves to challenge epoch plus window; finalize at the old deadline now reverts | `test_challenge_restarts_the_window_and_finalize_waits_again` | `challenge:eth_blob` then `guard` order in the scenario |
| Trading after close | `buy_outcome_shares` requires `now < close_epoch` | trading gate tests | `guard:early_trading` |
| Zero winner locks funds | finalize routes to `REFUNDABLE_ZERO_WINNERS`, `claim_refund` returns principal to everyone | `test_zero_winner_refund_returns_full_principal`, `test_zero_winner_double_refund_reverts`, `test_zero_winner_finalize_twice_reverts` | `refund:ai_sdk:alice`, `refund:ai_sdk:bob` |
| Unresolved market locks funds | `resolution_timeout_epoch` plus `expire_unresolved_market` plus `claim_refund` | `test_expire_before_timeout_reverts`, `test_expire_at_timeout_flips_to_expired`, `test_expired_market_refunds_every_participant` | `expire:abandoned`, `refund:abandoned:alice`, `refund:abandoned:bob` |
| Stale proposal after timeout | `propose_resolution` reverts, refund path is the only exit | expired market tests | `guard:post_timeout_proposal` |

## 1. Liveness

| Locked state | Escape | Verdict |
|---|---|---|
| OPEN with positions | anyone proposes after close; anyone expires after the timeout | safe, both paths exist |
| CHALLENGE_WINDOW | anyone finalizes after the deadline; challenges are capped at 2 so the window cannot be extended forever | safe |
| FINALIZED | each holder claims its own share | safe |
| REFUNDABLE_ZERO_WINNERS | every holder calls `claim_refund` | safe |
| EXPIRED | every holder calls `claim_refund` | safe |

Deadlines use objective epochs only. `challenge_resolution` requires
`now <= deadline`, `finalize_market` requires `now > deadline`, so the two
guards are mutually exclusive at the boundary and a challenge can never be
finalized around inside its own window.

## 2. Races

- buy versus close: the same `close_epoch` comparison decides both, first
  execution wins deterministically.
- propose versus expire: both require OPEN and propose requires
  `now < resolution_timeout_epoch`, expire requires `now >= timeout`. Mutually
  exclusive.
- challenge versus finalize: separated by the deadline comparison, and the
  challenge count cap bounds the total delay.
- finalize twice: the second sees a non CHALLENGE_WINDOW status and reverts
  (`test_zero_winner_finalize_twice_reverts`).
- claim versus refund: one shared `receipts` key per market and account, so the
  two paths cannot both pay (`test_zero_winner_double_refund_reverts`,
  `guard:double_refund`, `guard:double_claim`).
- refund wrong status: `[EXPECTED] no refund to claim` (`guard:refund_wrong_status`).
- double claim: the receipt key is written in the same transaction that pays.

## 3. Accounting

Invariant: `vault_custody_balance == sum(unclaimed market liabilities)`. A
challenge bond never sits in a separate limbo bucket: it is debited to the
forfeit pot (upheld) or retained by the challenger (overturned) inside the same
transaction that re-runs consensus, so the identity holds at every block.
Exposed by `check_vault_invariants()`. Asserted after every transition in the
direct suite and again on chain after the full scenario, including after both
refund lifecycles (expect `delta == 0`).

Rounding: `test_dust_is_conserved_to_the_last_claimant` proves the last claimant
absorbs the remainder and the sum equals the pot. Refunds:
`test_expired_market_refunds_every_participant` proves 100 percent principal
back to zero, `test_zero_winner_refund_includes_forfeited_bond` proves pro rata
scaling with a forfeited bond. `test_all_three_settlement_branches_conserve_funds`
runs payout, invalid refund and zero winner refund branches in one market set
and reconciles every wallet and the vault to exact wei with the supply
unchanged.

## 4. Input validation

Length caps on question and criteria, category allow list, URL scheme, host,
credential and private range checks, amount floors and ceilings, duration
bounds (1 to 525600 epochs), window bounds (1 to 1440 epochs), grace bounds
(1 to 40320 epochs), market cap, challenge cap, zero and self transfer
rejection. Each has a negative test, including constructor bounds
(`test_init_rejects_out_of_bounds_window`, `test_init_rejects_out_of_bounds_grace`).

## 5. Consensus

The verdict is produced only inside `gl.eq_principle.prompt_comparative` over
sanitized renderings of the primary source and the filed evidence. The payout
is driven by a three value label set, never by a free form model number.
Validators re-fetch both sources and must agree exactly on the outcome band,
the confidence anchor and the authenticity flag. Proposal, challenge
re-evaluation and window restart all pass the same gate. Direct tests exercise
the leader path only; live studionet transactions prove validator behaviour,
including that a consensus failure during a challenge leaves state and bonds
untouched (`test_challenge_consensus_failure_leaves_state_unchanged`).

Prompt injection: markup and instruction text inside evidence are defused and
stripped before the prompt. `test_prompt_injection_markup_is_stripped` proves
the raw closing tag and braces never reach the prompt. This is tested
sanitization, not a proof of injection immunity.

## Findings

### FIXED

| Finding | Proof |
|---|---|
| Permissionless clock could close a challenge window early (v1 finding A) | clock removed, epochs derive from block datetime, tombstone revert: `test_clock_manipulation_always_reverts`, `test_epochs_only_move_with_real_block_time`, on chain `guard:advance_clock` |
| Zero winner pot stayed locked forever (v1 finding B) | `REFUNDABLE_ZERO_WINNERS` plus `claim_refund`, `test_zero_winner_refund_returns_full_principal`, on chain `refund:ai_sdk:*` |
| OPEN market had no liveness valve (v1 finding C) | `resolution_timeout_epoch` plus `expire_unresolved_market` plus `claim_refund`, `test_expire_at_timeout_flips_to_expired`, on chain `expire:abandoned` and `refund:abandoned:*` |
| Owner or creator resolution bypass | `test_no_deterministic_resolution_entrypoints`, `test_access_model_declares_no_privileged_role` |
| Premature resolution before the deadline | `test_propose_before_close_reverts`, on chain `guard:early_resolution` |
| Premature claim before the window closes | `test_claim_before_window_close_reverts`, on chain `guard:early_claim` |
| Finalize around a pending challenge | `test_finalize_before_window_elapses_reverts`, window restart test, on chain `guard:early_finalize` |
| Double claim or double refund | `test_claim_twice_reverts`, `test_zero_winner_double_refund_reverts`, on chain `guard:double_claim`, `guard:double_refund` |
| Losing side or zero share claim | `test_losing_side_claim_reverts`, `test_zero_share_claim_reverts`, on chain `guard:losing_claim` |
| Rounding loss in payouts or refunds | `test_dust_is_conserved_to_the_last_claimant`, `test_all_three_settlement_branches_conserve_funds` |
| Malformed or ambiguous model output settles a market | `test_malformed_json_fails_closed`, `test_missing_confidence_fails_closed`, `test_confidence_out_of_range_fails_closed` |
| Unauthenticated evidence pays a side | `test_unauthenticated_source_refunds` |
| Prompt markup reaches the model | `test_prompt_injection_markup_is_stripped` |
| Challenge bond double refund or stalled challenge | single transaction challenge (file plus audit fused), status and count guards, `test_challenge_consensus_failure_leaves_state_unchanged` |

### OPEN

**D. Direct mode tests do not exercise validators.**
They run the leader only. Validator agreement is covered by the live studionet
transactions in `evidence/studionet_deployment.json`, where every consensus
step must finalize `FINALIZED` with `MAJORITY_AGREE`.

**E. A griefer can still challenge twice.**
Each successful challenge restarts a fresh window, so settlement can be delayed
by at most two windows (deployed window is 10 epochs, bounded delay 20 minutes)
and the bond is forfeited on an upheld challenge, making the delay costly.
No funds move during the delay beyond the locked pot.

Nothing currently open allows a payout to the wrong party or a permanently
locked principal: both lock cases have an enforced refund path verified on
chain.
