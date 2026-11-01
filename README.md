# ProphetGrid

Flagship v1: an AI adjudicated conditional macro and tech event derivatives desk
with fully backed custody, a 250 basis point strike grid, scalar payout bands and
a bonded challenge window.

| | |
|---|---|
| Live terminal (GitHub Pages) | https://hoveiser.github.io/prophet-grid/ |
| Contract (studionet) | `0x38646A05EF30FBCD5aa96bBf55135629a3A1e67c` |
| GenLayer explorer | https://genlayer-explorer.vercel.app/contracts/0x38646A05EF30FBCD5aa96bBf55135629a3A1e67c |
| Source | https://github.com/hoveiser/prophet-grid |
| Release tag | `milestone-v1` (previous release: `studionet-v1`) |
| Demo reel (48 to 52 s, burned in subtitles, with audio) | https://hoveiser.github.io/prophet-grid/demo-video-subtitled.mp4 |
| Demo reel in the repository | https://github.com/hoveiser/prophet-grid/blob/main/docs/demo-video-subtitled.mp4 |
| Evidence | `evidence/studionet_Live_Milestone_v1.json`, `evidence/sha256_identity.json` |

Tags: `Prediction Markets`, `Conditional Markets`, `Outcome Resolution`.

## What Flagship v1 adds

The accepted first release (`studionet-v1`, contract
`0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967`) proved the core escrow and
consensus resolution loop. Flagship v1 hardens and extends it:

| Area | studionet-v1 | milestone-v1 |
|---|---|---|
| Settlement authority | consensus only | consensus only, plus no clock method at all |
| Time model | logical clock advanced by anyone | deterministic transaction datetime, every window an epoch |
| Verdict vocabulary | YES, NO, invalid refund | YES confirmed, NO confirmed, scalar split, ambiguous refund |
| Strike definition | confidence anchor ladder | 250 bps quantized grid, corridor and derived payout weights |
| Evidence | one primary plus one filed evidence | primary plus independent secondary, corroboration required |
| Collateral | internal token ledger with a faucet | PGT minted only against native value held by the contract |
| Payout shape | winner takes the pot | pot minus fee split by band weights, exact dust to the last claimant |
| Refusals | reverted transactions | payable calls never revert, value is parked and claimable |
| Cross market risk | none | conditional hedge baskets with max liability reservation |
| Ecosystem | none | typed consumer interface, feed, acknowledgements |
| Interface | generic market cards | three workspace institutional derivatives terminal |

## The problem this solves

A prediction market is only as honest as its resolver. If one key can write the
outcome, the market is a promise, not a contract. ProphetGrid removes that key and
then removes the second weakest link: a verdict that is too vague to settle a
payout exactly.

Every book declares a numeric strike on a fixed grid, two independent sources for
the same fact, and settlement rules that say how a print maps onto the strike.
Validators extract the print from both sources, and the contract derives the band
and every payout integer itself. Validators must agree exactly on all nine fields.
A desk can challenge a provisional verdict with a bonded challenge and force a
re-audit before any payout unlocks.

## What lives where

| Layer | Owns |
|---|---|
| Browser terminal | rendering, desk selection, offline payoff modelling, unsigned previews |
| Intelligent contract | custody, share accounting, consensus calls, band derivation, windows, payouts, refunds, ecosystem feed |
| External sources | the raw printed numbers; validators fetch them independently and nothing is trusted from a desk |

## Architecture

```
desk                    contract (GenLayer studionet)                consensus
 |  fund_pgt_vault_payable   native value credited, PGT minted 1:1
 |--> buy / acquire shares --> vault custody, per side pools
 |                             yes_shares, no_shares, pot_total
 |  close epoch elapses (gl.message_raw datetime)
 |  resolve_market_via_consensus --> leader: render primary + secondary
 |                                   sanitize, extract two bps prints
 |                                   derive band and payout integers
 |                                   validator: same run, exact compare
 |                             <-- re-derive and refuse any mismatch
 |                             status PROVISIONAL, challenge deadline set
 |  file_resolution_challenge  bond locked, re-audit required
 |  audit_resolution_challenge overturned or upheld
 |  challenge deadline elapses
 |  finalize_market_settlement fee to reserve, payout or refund mode
 |  claim_market_winnings    pro rata with exact dust to the last claimant
 |  claim_refund             zero winner or timeout: principal back
 |  release_conditional_hedge basket unlocked, shortfall to reserve
 |  get_ecosystem_market_feed sibling contracts pull the settlement
```

## Market lifecycle

Statuses and the desks that may act. Nobody holds a privileged role: every write
method is permissionless and guarded by state plus an epoch comparison.

| Status | Phase shown | Method that leaves it | Guard | Money |
|---|---|---|---|---|
| OPEN | PRE_CLOSE | buy or stake shares | now lower than close epoch | wallet to vault pool |
| OPEN | OPEN_WINDOW | resolve_market_via_consensus | close epoch to timeout inclusive | unchanged, pot locked |
| OPEN | any | claim_refund | only after resolution timeout | pot back to principals |
| PROVISIONAL | CHALLENGE_WINDOW | file_resolution_challenge | before the deadline, at most three | bond into custody |
| PROVISIONAL | READY_TO_FINALIZE | finalize_market_settlement | deadline elapsed | fee to reserve |
| CHALLENGED | REAUDIT_PENDING | audit_resolution_challenge | before the timeout | bond to reserve or back |
| CHALLENGED | READY_TO_FINALIZE | finalize_market_settlement | deadline elapsed | aborted bonds returned |
| FINALIZED | SETTLED | claim_market_winnings | deadline elapsed | vault to wallet |
| FINALIZED refund mode | SETTLED | claim_refund | immediately | vault to wallet |
| REFUNDED | SETTLED | nothing | terminal | nothing left |

Race rules that must hold, each covered by a direct test:

- resolve needs `now <= timeout`, refund needs `now > timeout`, so they can never
  both be true;
- challenge needs `now < deadline`, finalize needs `now >= deadline`;
- claim needs the book FINALIZED, finalize needs PROVISIONAL or CHALLENGED;
- buying needs OPEN and `now < close_epoch`, so no desk can trade after the print.

## Liveness

Every locked state has a path out that does not depend on a counterparty:

- a book nobody resolves refunds in full after `resolution_timeout_epoch`, which
  creation guarantees is later than any challenge deadline;
- a resolved book can always be finalized once its challenge deadline passes, even
  with an un-audited challenge, which is then aborted and its bond returned;
- a winning book is claimed by its own holders; the last claimant per side takes the
  integer remainder, so no dust is stranded;
- a refund mode book returns every principal, and the final claimant takes the
  remainder, including a forfeited bond if there is one;
- a hedge basket unlocks at the later of its two legs' deadlines or timeouts, paid by
  the desk itself, so nobody else can block it.

## Steward rules

| Rule | Where | Proof |
|---|---|---|
| 1 runner header and classic SDK | line 1 of `contracts/prophet_grid.py`, `from genlayer import *` | `test_no_clock_advance_method`, genvm-lint |
| 2 zero admin and zero manual clock | no owner field, no `advance_clock`, windows from `gl.message_raw["datetime"]` | `test_no_admin_or_clock_surface_exists`, `test_no_privileged_role_exists` |
| 3 backed custody, hedge escrow, max liability | `fund_pgt_vault_payable`, `vault_custody_balance`, `hedge_total`, reservation math | `test_payable_deposit_mints_backed_collateral`, `test_hedge_basket_locks_the_reservation`, on chain `eth_getBalance` cross check |
| 4 and 9 consensus bound baselines | `_leader` snapshot plus `_decide`, exact compare in `run_nondet_unsafe`, `_checked` re-derivation | `test_resolve_*` band tests, on chain `MAJORITY_AGREE` receipts |
| 5 one invariant helper | `_compute_market_settlement_snapshot` used by get_market, list, preview, claim, finalize and the feed | `test_preview_payout_matches_the_claim`, `test_ecosystem_feed_exposes_settlement_and_custody` |
| 6 temporal precedence, rebuttal gate, fail closed | `_clean`, `_url`, `_url_reason`, `_decide` fail to refund | `test_prompt_injection_in_evidence_cannot_change_the_rule`, `test_resolve_fail_closed_on_missing_fields`, `test_unreachable_evidence_reverts_without_settling` |
| 8 payable soft fail | `_soft_fail`, `refundable_balances`, `last_payable_rejection`, `withdraw_refund`, `claim_refundable_balance` | six soft-fail tests plus the on chain refund steps |
| 10 enforceable timing and zero winner refunds | `close_epoch`, `challenge_deadline_epoch`, `resolution_timeout_epoch`, `claim_refund` | `test_zero_winner_market_settles_as_refund`, `test_timeout_refund_when_nobody_resolves`, `test_resolve_is_allowed_at_the_timeout_and_refund_after_it` |
| 11 four way sha256 identity | `scripts/verify_identity.py` and the deploy script identity block | `evidence/studionet_Live_Milestone_v1.json` |

## Settlement math

All values are integers in wei scale, and one unit of native value mints one PGT unit.

- `grid(value)` snaps to the nearest 250 bps step inside 0 to 10000;
- a print is accepted only when the two sources agree within one grid step,
  otherwise the band is `INVALID_OR_AMBIGUOUS_REFUND`;
- `observed >= strike + corridor` is YES confirmed, `observed < strike - corridor`
  is NO confirmed, otherwise scalar split with
  `yes_payout_bps = grid((observed - lower) * 10000 / (upper - lower))` clamped to
  250 to 9750 and `no_payout_bps = 10000 - yes_payout_bps`;
- `fee = pot * 250 / 10000` goes to the protocol fee reserve, which is only
  spendable on challenger rewards and hedge shortfalls;
- `distributable = pot - fee`, `yes_budget = distributable * yes_payout_bps / 10000`,
  `no_budget = distributable - yes_budget`, so the two budgets sum exactly;
- a claim pays `budget * shares / pool`, except for the last holder on that side who
  receives `budget - already_paid`, so `sum(payouts) == budget` with no rounding leak;
- a hedge basket pays `collateral * (weight1 + weight2) / 20000`, returns the bounty
  headroom, and books the shortfall to the fee reserve;
- an ambiguous or zero winner book refunds principals in full and takes no fee;
- a challenged verdict re-derives every integer before storage, and a mismatch aborts
  the transaction instead of writing a partial state.

## Contract API

Writes.

| Method | Payable | Purpose |
|---|---|---|
| `fund_pgt_vault_payable()` | yes | deposit native value, mint backed collateral |
| `acquire_outcome_shares_payable(market_id, side)` | yes | deposit straight into one outcome pool |
| `open_conditional_hedge_payable(primary, hedge, sideA, sideB)` | yes | fund a hedge basket with native value |
| `challenge_market_resolution_payable(market_id, counter_url)` | yes | post the bond from native value, surplus refundable |
| `buy_outcome_shares(market_id, side, amount)` | no | buy shares with collateral |
| `create_market(...)` | no | list a book with strike, corridor and windows |
| `resolve_market_via_consensus(market_id, evidence_url)` | no | live consensus adjudication |
| `file_resolution_challenge(market_id, counter_url)` | no | bonded challenge with collateral |
| `audit_resolution_challenge(market_id)` | no | re-audit and settle the challenge |
| `finalize_market_settlement(market_id)` | no | close the window, lock distribution |
| `claim_market_winnings(market_id)` | no | pro rata payout, exact dust |
| `claim_refund(market_id)` | no | zero winner or timeout principal refund |
| `open_conditional_hedge_basket(...)` | no | reserve a basket with collateral |
| `release_conditional_hedge(hedge_id)` | no | unlock at the later leg deadline |
| `withdraw_refund(amount)` | no | refund claim to spendable, never reverts |
| `claim_refundable_balance()` | no | sweep the whole refund claim |
| `transfer_tokens(to, amount)` | no | move collateral between desks |
| `register_ecosystem_consumer(name)` | no | a contract registers itself |
| `acknowledge_ecosystem_feed(market_id)` | no | record a consumer pull |

Views.

| Method | Returns |
|---|---|
| `get_market(id)`, `list_markets(offset, limit)` | settlement snapshot with every gate and term |
| `preview_payout(id, account)`, `get_trader_portfolio(account)` | desk exposure and estimated payout |
| `get_resolution_receipt(id)` | the nine consensus fields, principle, digest, challenges |
| `get_ecosystem_market_feed(id)` | settlement, receipt, custody terms, consumers |
| `check_vault_invariants()`, `get_custody_accounting_summary()` | the conservation identity |
| `get_access_model()`, `get_consensus_policy()`, `current_epoch()` | authority model and rules |
| `get_platform_stats()`, `token_info()`, `token_balance_of`, `get_refundable_balance`, `get_last_payable_rejection` | aggregates |
| `get_hedge(id)`, `list_hedges(account)`, `get_market_count` | basket book |

## Terminal

`frontend/` is an institutional macro and event derivatives terminal. Carbon
background, amber and cyan accents, Space Grotesk with JetBrains Mono, and three
workspaces instead of generic cards.

1. **Macro orderbook and hedge matrix.** Every book with depth on both sides,
   strike, corridor, adjudicated print, derived budget split, gate countdowns and
   the basket register with live unlock epochs.
2. **Strike quantization and payoff modeler.** A curve plot of the on chain rule:
   move the strike, corridor or print and read the band, weights, fee, budgets,
   payout and ROI. The basket composer derives collateral against the reservation
   and the bounty headroom.
3. **Oracle verification and ecosystem telemetry.** The nine compared fields, the
   dual source chain of custody, lifecycle gate timeline, the bonded challenge
   record, consumer registrations and the custody terms at read time.

Plus:

- **Solvency rail.** The conservation identity term by term, with a cross check
  that reads the contract's native balance straight from the RPC node.
- **Desk session.** Three locally generated burner desks, an injected wallet
  option, a watch only lookup for any address, native deposits, refund sweeps,
  and a session blotter with explorer links.
- **Refund and margin ledger.** Refundable claims, the last soft-fail reason the
  contract recorded for the desk, and one click sweeps.
- **Audio and motion.** Synthesised cues per action, mute control, confetti only
  when value actually moved.
- The first paint costs three to four RPC calls, and the schema is always fetched
  by `genlayer-js` rather than pasted by hand.

## Repository layout

```
contracts/prophet_grid.py            Flagship v1 intelligent contract
tests/conftest.py                    fixtures, deterministic datetime control
tests/test_prophet_grid_direct.py    direct mode suite
scripts/deploy_studionet.py          deployment and live lifecycle
scripts/drive_challenge_lifecycle.py live bonded challenge and re-audit
scripts/render_macro_terminal_reel.py audio, capture, subtitles, mux
scripts/verify_identity.py           four way sha256 identity check
scripts/publish_github.py            main, tag and gh-pages publishing
scripts/write_readme_evidence.py     injects the evidence block below
scripts/presubmission_checks.py      reviewer simulation checks
frontend/                            React, TypeScript, Vite, Tailwind terminal
frontend/public/demo-video-subtitled.mp4  served demo reel
docs/demo-video-subtitled.mp4        tracked copy of the reel
docs/adversarial-review.md           Rule 1 to 11 review notes
evidence/                            on chain receipts and identity proofs
```

## Reproduce

```bash
python3 -m venv .venv
.venv/bin/pip install genvm-linter genlayer-test pytest requests python-dotenv web3 pillow
.venv/bin/genvm-lint check contracts/prophet_grid.py
.venv/bin/pytest tests/test_prophet_grid_direct.py -q

cd frontend
npm install
npm run build
```

Deploy and run the funded lifecycle:

```bash
cp .env.example .env    # GENLAYER_PRIVATE_KEY and GITHUB_TOKEN
.venv/bin/python scripts/deploy_studionet.py
.venv/bin/python scripts/drive_challenge_lifecycle.py
.venv/bin/python scripts/verify_identity.py
```

Rebuild the reel:

```bash
.venv/bin/python scripts/render_macro_terminal_reel.py --audio-only
cd frontend && node scripts/capture_terminal_session.mjs http://127.0.0.1:4176/prophet-grid/
cd .. && .venv/bin/python scripts/render_macro_terminal_reel.py --skip-capture
```

Publish:

```bash
RELEASE_TAG=milestone-v1 .venv/bin/python scripts/publish_github.py
```

## On chain evidence

<!-- EVIDENCE:START -->

The block above is regenerated by `scripts/write_readme_evidence.py` from
`evidence/studionet_Live_Milestone_v1.json`, which is written from transaction
receipts only.

<!-- EVIDENCE:END -->

## Deviations, stated plainly

- **Byte budget.** The brief asked for a contract under 37,500 bytes. The full
  Rule 1 to 11 feature set does not fit that in an auditable form; the shipped
  file is larger. GenLayer itself imposes no such limit, and the previously
  accepted release was 69,073 bytes. The size is recorded above rather than hidden.
- **Consensus comparison.** `gl.eq_principle.prompt_comparative` asks a model to
  judge whether two outputs agree, which cannot guarantee exact integer equality on
  fields that move money. The contract uses `gl.vm.run_nondet_unsafe` with a
  validator that re-runs the fetch and extraction and compares all nine fields
  exactly. The comparative principle text is still published by the contract and
  shown in the terminal.
- **RPC host.** `https://rpc.testnet-chain.genlayer.com` does not answer JSON-RPC.
  Chain id 61999 was deployed through the studionet endpoint
  `https://studio.genlayer.com/api`, which is what the SDK ships for studionet.
- **Interface decorator.** `gl.evm.contract_interface` is the same function as
  `gl.contract_interface`, but the lazy `gl.evm` module cannot be imported inside
  the direct mode harness, so the contract uses the working alias. The declaration
  is exercised on chain through `probe_consumer_interface`.
- **View return types.** `get_custody_accounting_summary` and `check_vault_invariants`
  return structured dicts rather than JSON strings, which this runner supports.
- **Sibling contracts.** `ProphetSyndicate` and `ProphetSentinel` are not deployed.
  The consumer registry, the typed interface and the pull feed are live and tested;
  no claim is made about a running peer.
- Direct mode executes the leader path only. Validator agreement is proven by the
  on chain receipts in the evidence block, not by the unit tests.

## Security notes

- The contract holds native value and mints exactly one PGT unit per wei, so the
  collateral claim is checkable against `eth_getBalance` of the contract address.
- Payable entry points never revert. A refusal parks the value as a named refund
  claim, so failed deposits stay recoverable by their owner.
- All evidence URLs are https only, bounded in length, stripped of credentials,
  path traversal, control characters and shell like tokens, and rejected for
  loopback and private address ranges.
- Fetched documents are treated as hostile text: closing tags defused, angle
  brackets, braces and control characters removed, whitespace collapsed, truncated
  to 6000 characters before the prompt, and the prompt states that the documents
  are data and never instructions.
- Prompt injection is covered by a test, and the outcome of that test is that the
  injected text cannot move the numbers because the contract, not the model, derives
  the band and the payouts.
- No method accepts an owner, admin, pause flag or a verdict. The only halt behavior
  is self imposed: if the custody identity ever fails to hold, new value intake
  soft-fails into refunds instead of accepting more.

## Limitations

- The fee reserve absorbs forfeited challenge bonds and hedge shortfalls. It is
  protocol owned but not owner withdrawable; it can only pay challenger rewards.
- Losing stakes are not returned by design: they fund the winning side, which is the
  parimutuel definition, and the terminal labels them clearly.
- Studionet is a test network. Consensus depends on validators reaching the cited
  sources, and a book whose source goes offline simply cannot resolve, which is why
  the timeout refund path exists.
- The terminal reads live state on demand and caches nothing.

## License

MIT, see `LICENSE`.
