# ProphetGrid

AI adjudicated conditional macro and tech event prediction markets with a real
funded custody vault, objective epoch deadlines no caller can forge, a bonded
challenge window, and full refund paths for zero winner and expired markets.

| | |
|---|---|
| Live app (GitHub Pages) | https://hoveiser.github.io/prophet-grid/ |
| Contract (studionet) | `0x5d7776fc51b76DF271f232A56e2E76F3e2d0fcE8` |
| GenLayer explorer | https://genlayer-explorer.vercel.app/contracts/0x5d7776fc51b76DF271f232A56e2E76F3e2d0fcE8 |
| Source | https://github.com/hoveiser/prophet-grid |
| Demo video (48 s, burned in subtitles, with audio) | https://hoveiser.github.io/prophet-grid/demo-video-subtitled.mp4 |
| Demo video in the repository | https://github.com/hoveiser/prophet-grid/blob/main/docs/demo-video-subtitled.mp4 |
| Evidence | `evidence/studionet_deployment.json`, `evidence/sha256_identity.json` |

Tags: `Prediction Markets`, `Conditional Markets`, `Outcome Resolution`.

## The problem this solves

A prediction market is only as honest as its resolver. If one key can write the
outcome, the market is a promise, not a contract. ProphetGrid removes that key.
A market can only resolve through live validator consensus over external
evidence, only after an objective deadline derived from block time that no
caller can move, every resolution opens a bonded challenge window that cannot
be skipped or compressed, and every unit of collateral has a defined exit:
winners claim pro rata, and every participant is refunded in full when a
market has zero winners or is never resolved.

## Steward remediation (v2)

The builder program steward rejected v1 because "any caller can resolve a
market before an objective deadline and immediately advance the logical clock
past its challenge window, while zero-winner and unresolved markets can
permanently lock funds". This deployment (tag `studionet-v2-remediated`) closes
every clause:

| Rejection clause | v2 closure | Proof |
|---|---|---|
| Resolve before an objective deadline | `propose_resolution` reverts before `close_epoch`, which is frozen at creation from deterministic block time | `test_propose_before_close_reverts`, on chain `guard:early_resolution` |
| Advance the logical clock past the challenge window | the stored clock is deleted; epochs derive from block datetime; `advance_market_clock` always reverts; `finalize_market` requires `current_epoch > challenge_deadline_epoch` | `test_clock_manipulation_always_reverts`, `test_finalize_before_window_elapses_reverts`, on chain `guard:advance_clock`, `guard:early_finalize` |
| Zero winner markets lock funds | finalize converts them to `REFUNDABLE_ZERO_WINNERS`, `claim_refund` returns 100 percent of every principal with zero dust left | `test_zero_winner_*` and `test_all_three_settlement_branches_conserve_funds`, on chain `refund:ai_sdk:*` |
| Unresolved markets lock funds | `resolution_timeout_epoch` plus `expire_unresolved_market` plus `claim_refund` | `test_expire_*`, on chain `expire:abandoned`, `refund:abandoned:*` |

## What lives where

| Layer | Owns |
|---|---|
| GenLayer contract | Market state, collateral custody, live evidence adjudication, challenge adjudication, deterministic settlement math, payout receipts |
| Validators | Independent re-fetching of the primary source and the filed evidence, exact agreement on the outcome band, the confidence anchor and source authenticity |
| Frontend | Display, what-if projections, wallet UX, transaction submission, guard dry runs. Never the source of truth |
| External sources | Raw facts. Treated as untrusted text until sanitized and compared |

## Architecture

```
trader wallet ── buy YES / NO ──► ProphetGrid contract
                                   │
                                   ├── token ledger (PGT) + vault custody
                                   ├── market pools and forfeited bond pot
                                   │  epochs = objective block time // 60 s,
                                   │  no caller can move them
                                   ▼
   close_epoch (objective) ──► propose_resolution
                                   │ gl.nondet.web.render(primary)
                                   │ gl.nondet.web.render(evidence)
                                   │ sanitize, truncate, fence
                                   │ gl.nondet.exec_prompt (JSON)
                                   │ quantize to 5 anchors, derive band
                                   │ gl.eq_principle.prompt_comparative
                                   ▼
                      CHALLENGE_WINDOW (deadline = now + window)
                                   │
challenger ── challenge_resolution (bond, live re-consensus, window restarts)
                                   │ upheld (bond forfeited) / overturned (verdict replaced)
                                   ▼
        only after the deadline: finalize_market
                     │ winners pool > 0 ──► claim_market_payout (exact pro rata)
                     │ winning pool == 0 ──► REFUNDABLE_ZERO_WINNERS ──► claim_refund (100 percent principal)
      never resolved by the timeout ──► expire_unresolved_market ──► EXPIRED ──► claim_refund (100 percent principal)
```

## Market lifecycle

1. `OPEN`. Anyone creates a market with a public primary source, literal
   resolution criteria and a duration in epochs. One epoch is 60 seconds of
   objective block time, so `close_epoch` and `resolution_timeout_epoch` are
   frozen at creation and no transaction can move them. Anyone buys YES or NO
   shares at par until `close_epoch`. Collateral leaves the wallet and enters
   `vault_custody_balance`.
2. `CHALLENGE_WINDOW`. After `close_epoch` anyone can call
   `propose_resolution`. The contract renders both sources, sanitizes them,
   asks the model for a stance and a confidence, quantizes confidence onto the
   `0, 25, 50, 75, 100` ladder and derives the band deterministically.
   Validators must agree exactly on the band, the anchor and the authenticity
   flag. The market is then locked until `challenge_deadline_epoch`, and trades,
   claims and finalization are all blocked while the window is open.
3. Still `CHALLENGE_WINDOW` after a challenge. Inside the window anyone with
   the bond can call `challenge_resolution` with counter evidence. One
   transaction files the challenge and re-runs live consensus: an upheld
   challenge forfeits the bond into the market pot, an overturned challenge
   replaces the provisional verdict. Either way the window restarts from the
   challenge epoch, so a challenge can never be finalized around.
4. `FINALIZED` only after the deadline strictly elapses.
   `claim_market_payout` pays the caller's exact share. The last claimant
   absorbs the rounding dust, so `sum(payouts)` equals the pot to the unit.
5. `REFUNDABLE_ZERO_WINNERS`. If finalization finds a winning pool of zero
   (everyone staked the losing side), the pot is never stranded: the market
   converts to a full refund and every participant calls `claim_refund` to get
   100 percent of their principal back, pro rata scaled if bonds were forfeited.
6. `EXPIRED`. If no proposal lands before `resolution_timeout_epoch` (close
   plus a fixed grace), any participant calls `expire_unresolved_market` and
   then `claim_refund` for their full principal. No funded market has any
   terminal state other than payout or refund.

## Steward red lines

### 1. Zero owner or creator bypasses

There is no owner field, no admin role and no emergency settlement method.
`get_access_model()` returns `owner: null`, `privileged_roles: 0`, empty
`owner_only_methods` and `creator_only_methods`. A market can only leave
`OPEN` through `propose_resolution`, which is a consensus call gated behind the
objective close epoch. The direct test suite asserts that `resolve_market`,
`set_outcome`, `override_outcome`, `emergency_settle`, `admin_resolve` and
`force_settlement` do not exist.

### 2. Objective time, no forgeable clock

A v1 review finding said any caller could advance a logical clock past the
challenge window. That clock is gone. One epoch is 60 seconds of deterministic
block time, and `current_epoch` is derived per call from the transaction
datetime, never stored. `close_epoch`, `challenge_deadline_epoch` and
`resolution_timeout_epoch` are frozen integers set when the transaction
executes. `advance_market_clock` survives only as a tombstone that always
reverts with
`[EXPECTED] advance_market_clock is removed, epochs derive from block datetime
and cannot be manipulated`. There is no other method, privileged or
permissionless, that can compress a window: the only way to reach
`finalize_market` earlier is to wait for fewer real blocks, and that is the
consensus layer's job, not a caller's.

### 3. Real funded custody vault with maximum liability reservation

`faucet_or_deposit(amount)` mints demo collateral and credits the token ledger.
`transfer_tokens(to, amount)` moves liquid collateral. `buy_outcome_shares`
debits the trader, credits `vault_custody_balance` and the market pool, and
reverts with `[EXPECTED] market trading window is closed` at or after
`close_epoch`. While a market is `CHALLENGE_WINDOW`, the entire pot is
reserved: claims and finalization refuse with
`[EXPECTED] payout blocked: CHALLENGE_WINDOW_OPEN`.

`check_vault_invariants()` proves the single custody identity on chain:

```
vault_custody_balance == sum(unclaimed market liabilities: pots, refunds and dust to the last claimant)
```

A challenge settles inside one transaction (the bond is either forfeited to the
pot or kept by the challenger in the same call that re-runs consensus), so no
bond is ever parked in a limbo bucket that the identity could miss.

### 4. Discrete outcome band bound inside consensus

All storage reads happen before the non deterministic block. The adjudication
helper receives only plain strings. Inside the block:

- both pages are rendered with `gl.nondet.web.render(url, mode="text")`
- documents are sanitized: closing tags defused, `< > { }` stripped, control
  characters and DEL replaced, whitespace collapsed, truncated to 6000 chars
- the prompt fences untrusted text and forbids following instructions in it
- the model returns `stance`, `confidence`, `source_authenticated`, `summary`
- confidence is quantized with integer math onto `0, 25, 50, 75, 100`
- the band is derived deterministically: unauthenticated evidence or an anchor
  below 75 always yields `OUTCOME_INVALID_REFUND`
- malformed output becomes `UNDETERMINED`, which never settles a market

`gl.eq_principle.prompt_comparative` requires exact agreement on `outcome_band`,
`confidence_anchor` and `source_authenticated`. After consensus the contract
re-derives the band from the stance, anchor and authenticity flag and reverts
with `[LLM_ERROR]` on any mismatch. The same adjudication runs for
`propose_resolution` and for every `challenge_resolution`.

### 5. Single coherent invariant helper

`_market_settlement_state(market, now_epoch)` is the only gate model. It is
used identically by `get_market`, `preview_payout`, `propose_resolution`,
`challenge_resolution`, `finalize_market`, `expire_unresolved_market`,
`claim_market_payout` and `claim_refund`, so the display, the preview and the
transfer can never disagree.

### 6. Refund paths, zero locked funds

The v1 review found that zero winner and unresolved markets could lock pot
funds permanently. Both now have enforced exits, and neither can pay a side:

- `finalize_market` with a winning pool of zero converts the market to
  `REFUNDABLE_ZERO_WINNERS` and moves the whole principal pool into the refund
  bucket. Every participant calls `claim_refund(market_id)` for 100 percent of
  principal (pro rata scaled if bonds were forfeited), and the last claimant
  absorbs the dust so the bucket lands on exactly zero.
- If no `propose_resolution` lands before `resolution_timeout_epoch`, any
  participant calls `expire_unresolved_market(market_id)`, the market becomes
  `EXPIRED`, and the same `claim_refund` path returns every principal in full.
  After the timeout, `propose_resolution` itself reverts with
  `[EXPECTED] resolution timeout elapsed, call expire_unresolved_market for
  refunds`, so a stale resolution can never front run the refund.
- `advance_market_clock` cannot fast forward to a timeout either: epochs are
  block time, so a refund path only unlocks after the event has objectively
  happened.

## Settlement math

Parimutuel, one token per share. For a YES win:

```
total_pot      = yes_pool + no_pool + forfeited_bonds
winning_pool   = yes_pool
payout_i       = shares_i * total_pot // winning_pool
last claimant  = total_pot - paid_out
```

Example with rounding dust: YES pool 3 (Alice 1, Bob 2), NO pool 1, so the pot
is 4. Alice receives `1 * 4 // 3 = 1`. Bob is the last claimant and receives
`4 - 1 = 3` instead of `2`. The sum is exactly the pot.

For `OUTCOME_INVALID_REFUND`, `REFUNDABLE_ZERO_WINNERS` and `EXPIRED` the basis
is the caller's principal, so a clean refund returns 100 percent of stake. If a
challenge bond was forfeited into the pot, the refund scales pro rata across
all principal.

## Contract API

| Method | Kind | Purpose |
|---|---|---|
| `faucet_or_deposit(amount)` | write | Mint demo collateral, capped per call and in total supply |
| `transfer_tokens(to, amount)` | write | Move liquid collateral |
| `create_market(question, category, primary, criteria, duration_epochs)` | write | Permissionless creation, freezes `close_epoch` and `resolution_timeout_epoch` |
| `buy_outcome_shares(market_id, side, amount)` | write | Buy YES or NO at par, only while `current_epoch < close_epoch` |
| `propose_resolution(market_id, evidence_url)` | write | Live consensus resolution, only between close and the timeout |
| `challenge_resolution(market_id, counter_url)` | write | Bond plus live re-consensus in one transaction, restarts the window |
| `finalize_market(market_id)` | write | Only after `current_epoch > challenge_deadline_epoch`, routes zero winner pots to refund |
| `expire_unresolved_market(market_id)` | write | Any participant, only after `resolution_timeout_epoch`, converts to `EXPIRED` |
| `claim_market_payout(market_id)` | write | Exact pro rata payout for winners and invalid refunds |
| `claim_refund(market_id)` | write | 100 percent principal refund for `REFUNDABLE_ZERO_WINNERS` and `EXPIRED` markets |
| `advance_market_clock(steps)` | write | Removed. Permanent tombstone that always reverts |
| `get_market`, `list_markets`, `get_platform_stats` | view | Read models |
| `get_trader_portfolio`, `preview_payout` | view | Position and payout preview |
| `check_vault_invariants` | view | Custody identity proof |
| `get_resolution_receipt`, `get_challenge`, `get_payout_receipt` | view | Audit trail |
| `get_access_model`, `get_consensus_spec` | view | Machine readable security model |

## Frontend

React, TypeScript, Vite, TailwindCSS, lucide-react, canvas-confetti and
genlayer-js. Highlights:

- Dark institutional quant layout with SVG implied probability gauges.
- Interactive What-If simulator with sliders for both pools, the stake and the
  resolution band, showing implied odds, payout, ROI, the dust bonus and a
  conservation check.
- Consensus and prompt inspector drawer with the exact comparative principle,
  the sanitizer rules, the five anchor ladder, the fail-closed parse policy and
  the validator receipt for the selected market.
- Security Guard Lab with dry runs and live probes for a premature claim, an
  injection attempt inside evidence text and a zero-share claim.
- Web Audio synthesizer for interface feedback with a header mute toggle.
- Dual wallet: one click burner wallets with identity switching, plus MetaMask
  as a read identity (writes need a burner or the GenLayer snap).
- The initial load performs exactly three RPC calls: `get_platform_stats`,
  `list_markets` and `get_trader_portfolio`. `readContract` never receives a
  hand written ABI, so genlayer-js always fetches the deployed schema.

## Repository layout

```
contracts/prophet_grid.py          Intelligent contract
tests/conftest.py                  Direct mode fixtures and mocks
tests/test_prophet_grid_direct.py  107 direct tests
scripts/deploy_studionet.py        Idempotent studionet deployment and scenario
scripts/seed_demo_market.py        Extra markets for the interactive demo
scripts/verify_identity.py         Four way sha256 identity check
scripts/publish_github.py          Repo, gh-pages and Pages publishing
frontend/                          React application
tools/generate_logo.py             Deterministic 512 px logo renderer
tools/generate_soundtrack.py       48 s ambient soundtrack synthesizer
frontend/scripts/record_demo.mjs   Playwright live UI recording
tools/build_video.py               Subtitles, audio and compression
docs/demo-video-subtitled.mp4      Generated demo video (tracked, also served on Pages)
evidence/                          On chain receipts and identity proofs
```

## Reproduce

```bash
python3 -m venv .venv
.venv/bin/pip install genvm-linter genlayer-test pytest websockets
.venv/bin/genvm-lint check contracts/prophet_grid.py
.venv/bin/pytest tests/test_prophet_grid_direct.py -q

cd frontend
npm install
npm run build
```

Deploy and run the funded scenario:

```bash
cp .env.example .env   # add GENLAYER_PRIVATE_KEY and GITHUB_TOKEN
.venv/bin/python scripts/deploy_studionet.py
.venv/bin/python scripts/seed_demo_market.py
.venv/bin/python scripts/verify_identity.py
```

Rebuild the demo assets:

```bash
.venv/bin/python tools/generate_logo.py
.venv/bin/python tools/generate_soundtrack.py
cd frontend && npx vite preview --port 4173 --host 127.0.0.1
node scripts/record_demo.mjs
cd .. && .venv/bin/python tools/build_video.py
```

## On chain evidence

<!-- EVIDENCE:START -->

### Deployment

| Field | Value |
|---|---|
| Network | studionet (chain 61999) |
| Contract | `0x5d7776fc51b76DF271f232A56e2E76F3e2d0fcE8` |
| Deployer | `0x3de43AA2f7162c80af98abe78222aE0Cdf83c506` |
| Deploy transaction | `0xaa8f3ad6ba7a793feeaa36fbb384295eb24331cf5921b3f7a2c2f1577c126363` |
| Contract commit | `1af7288fb56ef8e5106dbab92fd2cfec5009ff50` |
| Tag | `studionet-v2-remediated` |
| Runner pin | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Epoch length | 60 seconds of objective block time |
| Challenge window | 10 epochs |
| Resolution grace | 24 epochs after close |
| Challenge bond | 50 PGT |
| Transactions recorded | 45 |

### Seeded markets

| Id | Question | Status | Outcome | Pot |
|---|---|---|---|---|
| 1 | Did EIP-7691 raise the Ethereum blob target to 6 and the maximum to 9 per b... | FINALIZED | OUTCOME_YES | 850 |
| 3 | Does the official openai python package metadata link to its GitHub reposit... | REFUNDABLE_ZERO_WINNERS | OUTCOME_YES | 240 |
| 4 | Is the latest World Bank US GDP observation above 20 trillion US dollars? | FINALIZED | OUTCOME_YES | 280 |
| 5 | Will the demo abandoned market ever receive a consensus resolution proposal? | EXPIRED |  | 60 |

### Signers

| Role | Address |
|---|---|
| deployer | `0x3de43AA2f7162c80af98abe78222aE0Cdf83c506` |
| alice | `0xB11975cfe62e77e746479854d1f9fC37c990e06f` |
| bob | `0x1F0447eb0F75aCfc572a2EA7c33C68280266e5a5` |
| carol | `0xea6BBbC45a3a6b9acD276534CCdB452137a05f3F` |

### Guards and consensus

| Guard | Transaction | Execution | Matched |
|---|---|---|---|
| guard:advance_clock | `0xa7c6abdd5246ed7e...` | ERROR | yes |
| guard:double_claim:eth_blob:alice | `0xb6c53bae87de1e8a...` | ERROR | yes |
| guard:double_claim:macro_gdp:bob | `0xe3eaed90171fdf64...` | ERROR | yes |
| guard:double_refund:ai_sdk | `0x2693733d110a1208...` | ERROR | yes |
| guard:early_claim | `0xed8ad6fc675f3faa...` | ERROR | yes |
| guard:early_expiry | `0xdf963c0696f66fb2...` | ERROR | yes |
| guard:early_finalize | `0xaff05f7de7e1aba8...` | ERROR | yes |
| guard:early_resolution | `0x2f9823295cbe01bc...` | ERROR | yes |
| guard:early_trading | `0x15a5c3179245600a...` | ERROR | yes |
| guard:losing_claim:eth_blob:bob | `0x50e8bbbbffe0f16d...` | ERROR | yes |
| guard:losing_claim:macro_gdp:carol | `0x3af4f67edf421603...` | ERROR | yes |
| guard:post_timeout_proposal | `0x663da8833f5a0a70...` | ERROR | yes |
| guard:refund_wrong_status | `0x1996e04999402430...` | ERROR | yes |

| Consensus step | Status | Result | Agree votes |
|---|---|---|---|
| challenge:eth_blob | FINALIZED | MAJORITY_AGREE | 3/5 |
| resolve:ai_sdk | FINALIZED | MAJORITY_AGREE | 3/5 |
| resolve:eth_blob | FINALIZED | MAJORITY_AGREE | 3/5 |
| resolve:macro_gdp | FINALIZED | MAJORITY_AGREE | 3/5 |

### Refund lifecycle (zero winner and timeout paths)

| Step | Transaction | Function | Status | Result | Execution |
|---|---|---|---|---|---|
| expire:abandoned | `0x0f9cb2a267fc4189...` | expire_unresolved_market | FINALIZED | MAJORITY_AGREE | SUCCESS |
| refund:abandoned:alice | `0x49f0b49b3a8bf5aa...` | claim_refund | FINALIZED | MAJORITY_AGREE | SUCCESS |
| refund:abandoned:bob | `0x0e22a2d72fb58faa...` | claim_refund | FINALIZED | MAJORITY_AGREE | SUCCESS |
| refund:ai_sdk:alice | `0x5cba793da1043001...` | claim_refund | FINALIZED | MAJORITY_AGREE | SUCCESS |
| refund:ai_sdk:bob | `0x1986d1349831be82...` | claim_refund | FINALIZED | MAJORITY_AGREE | SUCCESS |

### Custody invariant after settlement

```
vault_custody_balance      = 0
locked_market_pots         = 0
active_challenge_bonds     = 0
expected_custody           = 0
delta                      = 0
invariant_ok               = True
total_volume               = 1380
total_paid_out             = 1430
```

### Four way sha256 identity

| Source | sha256 | Bytes |
|---|---|---|
| Local LF file | `135a6d9726bc8357cd7a2c15a98aa8320a5bca8b57ba60576b7bf46c31c03ae0` | 84418 |
| Git blob | `186306f79ddf64f74b130b22a867152c2d0f5f429b3a2872b307f4e268a9ab7d` | 69073 |
| On chain code | `135a6d9726bc8357cd7a2c15a98aa8320a5bca8b57ba60576b7bf46c31c03ae0` | 84418 |
| GitHub raw file | `186306f79ddf64f74b130b22a867152c2d0f5f429b3a2872b307f4e268a9ab7d` | None |

Local equals git: no. Local equals on chain: yes. All four equal: no.

### Local verification recorded with the evidence

- `genvm-lint check`: failed
- Direct tests: passed (107 passed, 0 failed)
- `107 passed in 7.27s`

<!-- EVIDENCE:END -->

## Security notes

- Expected business errors use the `[EXPECTED]` prefix, external 4xx errors use
  `[EXTERNAL]`, network and 5xx errors use `[TRANSIENT]`, and malformed model
  output uses `[LLM_ERROR]`. Deterministic prefixes are compared exactly during
  consensus.
- Evidence URLs must be public http or https, without credentials, path
  traversal, loopback, private ranges or IP literals.
- A challenge settles in one transaction: bond debit, live re-consensus and
  the verdict update either all happen or none do. If consensus fails during a
  challenge the market state is untouched and the bond is not consumed, so no
  challenge can ever park a market in a half decided state. A market that never
  gets proposed at all falls through to `expire_unresolved_market` and the
  refund path. None of these fallbacks can pay a side, they only refund.
- The token is a demo collateral ledger with an open faucet. It has no monetary
  value and is not a security.

## Limitations

- Studionet is a test network. Consensus results depend on validator web access
  to the cited sources.
- The LLM can return `UNDETERMINED`, in which case the transaction reverts and
  the market stays open. This is intentional: a malformed model response must
  never settle a market.
- The frontend caches nothing; every refresh is three live RPC calls.
- A market can only be challenged twice, so a griefer cannot extend the window
  forever by chaining challenges.
- The v1 liveness findings (forgeable clock, zero winner pot lock, no unresolved
  market fallback) are closed in v2: the clock is gone, `REFUNDABLE_ZERO_WINNERS`
  and `EXPIRED` with `claim_refund` cover both lock cases, and the review in
  `docs/adversarial-review.md` tracks the live and test proof for each.

## License

MIT.
