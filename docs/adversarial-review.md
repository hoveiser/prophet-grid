# Adversarial review, Flagship v1

Review of `contracts/prophet_grid.py` as shipped for `milestone-v1`. Every party
that can call the contract is treated as hostile, including the resolver, the
challenger, the listing desk, the model output and any fetched page. Findings are
marked FIXED with the test or transaction that proves it, or OPEN with the reason.

## State machine

| Status | Who may act | Method | Next | Funds |
|---|---|---|---|---|
| none | any desk | `create_market` | OPEN | nothing moves |
| OPEN, before close | any desk with collateral | `buy_outcome_shares`, `acquire_outcome_shares_payable` | OPEN | wallet or native deposit into the pool |
| OPEN, after close | any desk | `resolve_market_via_consensus` | PROVISIONAL | pot locked, nothing paid |
| OPEN, after timeout | any desk holding principal | `claim_refund` | REFUNDED | pot back to principals |
| PROVISIONAL, before deadline | any desk except one with an open challenge | `file_resolution_challenge`, `challenge_market_resolution_payable` | CHALLENGED | bond into custody |
| PROVISIONAL, after deadline | any desk | `finalize_market_settlement` | FINALIZED | fee to reserve, mode chosen |
| CHALLENGED, before timeout | any desk | `audit_resolution_challenge` | PROVISIONAL | bond to reserve or back to challenger |
| CHALLENGED, after deadline | any desk | `finalize_market_settlement` | FINALIZED | open bonds returned first |
| FINALIZED payout, after deadline | holders with a winning side | `claim_market_winnings` | FINALIZED or REFUNDED | vault to wallet |
| FINALIZED refund mode | any holder | `claim_refund` | REFUNDED | principals back |
| hedge LOCKED | basket owner only | `release_conditional_hedge` | RELEASED | payoff plus headroom back, shortfall to reserve |

## Liveness of locked value

- Funded but never resolved: `claim_refund` unlocks for every holder after
  `resolution_timeout_epoch`, which creation forces to be later than any possible
  challenge deadline. Proven on chain: book PG:4 refunded 50 units after its source
  stopped loading.
- Resolved and never finalized: `finalize_market_settlement` is permissionless once
  the deadline passes, and it returns open bonds first.
- Resolved, challenged, never audited: the same finalize path aborts the challenge
  and returns the bond.
- Resolved and refunded while a challenge is open: `claim_refund` aborts open
  challenges and returns their bonds. This was a lock-up bug found in this review
  and fixed before shipping, see finding 1.
- Settled payout: every claimant can claim independently; the last claimant on a
  side takes the integer remainder so no dust is stranded.
- Hedge basket: releasable by its owner at the later of the two legs' gates, with
  unsettled legs priced at principal equivalent.

## Races checked

- resolve versus timeout refund: `now <= timeout` against `now > timeout`, strict on
  one side.
- challenge versus finalize: `now < deadline` against `now >= deadline`.
- claim versus finalize: FINALIZED against PROVISIONAL or CHALLENGED.
- buy versus resolve: OPEN and `now < close_epoch` against not OPEN.
- claim versus claim: shares are zeroed in the same write that pays.
- refund versus claim: refund mode and payout mode are exclusive fields.
- double challenge by the same desk or on the same book: rejected by the gate.

## Invariant

`total_supply == native_custody_balance == wallet_balances + vault_custody_balance`
and `vault_custody_balance == locked_pots + pending_bonds + hedge_reservations +
protocol_reserve + refundable`. Every value movement goes through one of `_mint`,
`_credit`, `_debit`, `_park_native` plus a single term counter, so both sides of the
identity move together. `check_vault_invariants()` recomputes the terms on chain and
the evidence additionally compares the reported native custody with `eth_getBalance`
of the contract address from the node.

## Findings

### FIXED

1. **Open challenge bond stranded by the timeout refund.** `claim_refund` moved a
   PROVISIONAL or CHALLENGED book to REFUNDED without returning the bond of a pending
   challenge, and `finalize_market_settlement` could no longer run, so the challenger
   lost the bond permanently. Fixed by `_abort_pending_challenges`, now called from
   both paths. Proof: `test_timeout_refund_returns_an_open_challenge_bond`. This fix
   required a new deployment, so the contract address in the README is the reviewed
   build, not the intermediate one.
2. **Payable methods could revert, breaking Rule 8.** `_file_challenge` validated the
   counter evidence url after mutating the market, and `_open_hedge` raised when the
   collateral floor was not met. Both now validate before any mutation, and the
   payable entry points check with the non raising `_url_reason` and a collateral
   pre check, so a refusal parks the value instead of reverting. Proofs:
   `test_payable_challenge_with_a_bad_url_soft_fails`,
   `test_payable_hedge_below_minimum_soft_fails`,
   `test_payable_hedge_on_unknown_market_soft_fails`.
3. **Double counted native value on a challenge surplus.** The surplus branch added
   the whole deposit to supply, vault and native custody a second time after
   `_park_native` had already done it. Removed; the surplus now only moves between the
   refundable term and the vault. Proof: `test_payable_challenge_parks_the_surplus_as_refundable`
   plus the invariant assertion in the same test.
4. **Refund bookkeeping could leave unclaimed shares non zero.** The first draft
   decremented the wrong side, which would have let a second desk claim again. Fixed
   with explicit per side decrements and a last claimant branch. Proofs:
   `test_double_refund_claim_is_rejected`, `test_refund_band_returns_principal_to_everyone`.
5. **Winning budget could exceed the distributable when both sides had weight.**
   Budgets are now derived as `yes_budget` and `distributable - yes_budget`, so they
   sum exactly, and the last claimant per side receives the remainder. Proofs:
   `test_scalar_split_pays_both_sides_exactly`,
   `test_many_holders_conserve_the_winning_budget`.
6. **A winning side with no holders locked the whole pot.** Settlement now switches to
   refund mode and takes no fee when any side with positive weight has no unclaimed
   shares. Proofs: `test_zero_winner_market_settles_as_refund`, and on chain book PG:7.
7. **A model response could decide a payout.** The model only reports two numbers and
   a corroboration flag; the band, the weights, the fee and the reward are derived by
   `_decide` from the snapshotted pools, and `_checked` re-derives them after
   consensus and rejects any mismatch. Proofs:
   `test_prompt_injection_in_evidence_cannot_change_the_rule`,
   `test_resolve_fail_closed_on_missing_fields`,
   `test_resolve_refunds_when_the_two_sources_disagree`.
8. **Off grid or unbounded parameters.** Strike and corridor must sit on the 250 bps
   grid, all three windows have a floor of 60 seconds and a ceiling, stake and bond
   have bounds, urls are https only with private and loopback hosts rejected. Proofs:
   the parametrized listing tests and `test_create_market_enforces_window_floor_and_ceiling`.
9. **Consumer registration spoofing.** `register_ecosystem_consumer` registers
   `gl.message.sender_address` only, so a desk cannot claim to be another contract, and
   names are now unique. Proofs: `test_register_ecosystem_consumer_and_acknowledge`,
   `test_acknowledge_requires_registration`, `test_consumer_names_are_unique`.
10. **Unpaid challenger reward could overdraw the reserve.** The reward is
    `min(pot * 2500 / 10000, protocol_reserve)` and the payout path takes the same
    minimum, so a reward can never exceed what the reserve holds. Proof:
    `test_overturned_challenge_returns_the_bond_and_pays_the_reward`.

### OPEN

1. **The resolver picks which of the two declared sources is filed.** The choice is
   limited to the two urls stored on the book, both are public and the outcome can
   still be challenged, but the first resolver does get to pick the framing. A
   commit reveal stage would remove it and is the natural next version.
2. **A challenger gets no reward until the reserve holds fees.** Correct by
   construction, but it means the very first challenge on a fresh deployment is
   unpaid effort.
3. **A hedge basket is releasable only by its owner.** If the owner key is lost the
   reservation stays locked in the vault forever. No other desk is harmed because the
   term is counted as reserved, but there is no third party rescue path.
4. **Anyone may list unlimited books.** Storage grows with no fee. It is a griefing
   channel, not a fund risk, and the terminal hides unfunded listings by default.
5. **Direct mode runs the leader path only.** Validator exactness is demonstrated by
   the on chain `MAJORITY_AGREE` receipts with the vote counts in
   `evidence/studionet_Live_Milestone_v1.json`, not by the unit tests.
6. **The contract cannot read its own native balance.** Custody is contract accounting
   plus the external node cross check in the evidence. A plain value transfer to the
   contract address that bypasses a payable method is not reachable through the
   studionet write path, and if it ever becomes reachable the accounting would
   understate rather than overstate custody.

## Conclusion

Ten findings were fixed, each with a named test, and two of them (the stranded
challenge bond and the refund bookkeeping) were fixed after the first live run, which
is why the shipped contract is a fresh deployment. Six items remain open; none of them
let a party take funds that are not theirs, and each is listed above with the reason
and the shape of a fix.
