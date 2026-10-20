# ProphetGrid

AI adjudicated conditional macro and tech event prediction markets with a real
funded custody vault, a bonded challenge window, and exact pro rata settlement.

| | |
|---|---|
| Live app (GitHub Pages) | https://hoveiser.github.io/prophet-grid/ |
| Contract (studionet) | `0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967` |
| GenLayer explorer | https://genlayer-explorer.vercel.app/contracts/0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967 |
| Source | https://github.com/hoveiser/prophet-grid |
| Demo video (local build) | `docs/demo-video-subtitled.mp4` (48 s, burned in subtitles, gitignored by policy) |
| Evidence | `evidence/studionet_deployment.json`, `evidence/sha256_identity.json` |

Tags: `Prediction Markets`, `Conditional Markets`, `Outcome Resolution`.

## The problem this solves

A prediction market is only as honest as its resolver. If one key can write the
outcome, the market is a promise, not a contract. ProphetGrid removes that key.
A market can only resolve through live validator consensus over external
evidence, every resolution opens a bonded challenge window, and every unit of
collateral is provably reserved in a custody vault until settlement.

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
                                   │
resolver ── resolve_market_live ──►│ gl.nondet.web.render(primary)
                                   │ gl.nondet.web.render(evidence)
                                   │ sanitize, truncate, fence
                                   │ gl.nondet.exec_prompt (JSON)
                                   │ quantize to 5 anchors, derive band
                                   │ gl.eq_principle.prompt_comparative
                                   │ post consensus re-verification
                                   ▼
                            PROVISIONAL verdict
                                   │
challenger ── file_resolution_challenge (bond)
                                   ▼
                            CHALLENGED + bond locked
                                   │
anyone ── audit_resolution_challenge (second live audit)
                                   │
                    upheld (bond forfeited) / overturned (bond refunded)
                                   ▼
                        challenge window closes
                                   │
anyone ── finalize_market_settlement
                                   ▼
                        claim_market_payout (exact pro rata)
```

## Market lifecycle

1. `OPEN`. Anyone creates a market with a public primary source and literal
   resolution criteria. Anyone buys YES or NO shares at par, one token per share.
   Collateral leaves the wallet and enters `vault_custody_balance`.
2. `PROVISIONAL`. Anyone triggers a live resolution. The contract renders both
   sources, sanitizes them, asks the model for a stance and a confidence, then
   quantizes confidence onto the `0, 25, 50, 75, 100` ladder. The outcome band is
   derived deterministically. Validators must agree exactly on the band, the
   anchor and the authenticity flag.
3. `CHALLENGED`. Inside the challenge window anyone can stake a fixed bond and
   submit independent counter evidence. The whole pot and the bond stay locked.
4. `PROVISIONAL` again after the re-audit. An upheld challenge forfeits the bond
   into the market pot. An overturned challenge refunds the bond and replaces the
   verdict.
5. `FINALIZED` after the window closes. `claim_market_payout` pays the caller's
   exact share. The last claimant absorbs the rounding dust, so `sum(payouts)`
   equals the pot to the unit.

## Steward red lines

### 1. Zero owner or creator bypasses

There is no owner field, no admin role and no emergency settlement method.
`get_access_model()` returns `owner: null`, `privileged_roles: 0`, empty
`owner_only_methods` and `creator_only_methods`. A market can only move to
`PROVISIONAL` through `resolve_market_live`, which is a consensus call. The
direct test suite asserts that `resolve_market`, `set_outcome`,
`override_outcome`, `emergency_settle`, `admin_resolve` and `force_settlement`
do not exist.

### 2. Real funded custody vault with maximum liability reservation

`faucet_or_deposit(amount)` mints demo collateral and credits the token ledger.
`transfer_tokens(to, amount)` moves liquid collateral. `buy_outcome_shares`
debits the trader, credits `vault_custody_balance` and the market pool. While a
market is `PROVISIONAL` or `CHALLENGED`, the entire pot plus every pending
challenge bond is reserved: `claim_market_payout` refuses with
`[EXPECTED] payout blocked: CHALLENGE_WINDOW_OPEN` or
`[EXPECTED] payout blocked: REAUDIT_PENDING`.

`check_vault_invariants()` proves the single custody identity on chain:

```
vault_custody_balance == sum(remaining market pots) + sum(active challenge bonds)
```

### 3. Discrete outcome band bound inside consensus

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
with `[LLM_ERROR]` on any mismatch.

### 4. Single coherent invariant helper

`_market_settlement_state(market, now)` is the only settlement read model. It is
used identically by `get_market`, `preview_payout`,
`finalize_market_settlement` and `claim_market_payout`, so the display, the
preview and the transfer can never disagree.

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

For `OUTCOME_INVALID_REFUND` the basis is the caller's principal, so a clean
refund returns 100 percent of stake. If a challenge bond was forfeited into the
pot, the refund scales pro rata across all principal.

## Contract API

| Method | Kind | Purpose |
|---|---|---|
| `faucet_or_deposit(amount)` | write | Mint demo collateral, capped per call and in total supply |
| `transfer_tokens(to, amount)` | write | Move liquid collateral |
| `create_market(question, category, primary, criteria)` | write | Permissionless market creation |
| `buy_outcome_shares(market_id, side, amount)` | write | Buy YES or NO at par |
| `advance_market_clock(steps)` | write | Permissionless bounded logical clock |
| `resolve_market_live(market_id, evidence_url)` | write | Live consensus resolution |
| `file_resolution_challenge(market_id, counter_url)` | write | Stake a bond inside the window |
| `audit_resolution_challenge(market_id)` | write | Second live audit over counter evidence |
| `finalize_market_settlement(market_id)` | write | Close the window and open claims |
| `claim_market_payout(market_id)` | write | Exact pro rata payout |
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
  unauthenticated evidence URL and a zero-share claim.
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
tests/test_prophet_grid_direct.py  80 direct tests
scripts/deploy_studionet.py        Idempotent studionet deployment and scenario
scripts/seed_demo_market.py        Extra markets for the interactive demo
scripts/verify_identity.py         Four way sha256 identity check
scripts/publish_github.py          Repo, gh-pages and Pages publishing
frontend/                          React application
tools/generate_logo.py             Deterministic 512 px logo renderer
tools/generate_soundtrack.py       48 s ambient soundtrack synthesizer
frontend/scripts/record_demo.mjs   Playwright live UI recording
tools/build_video.py               Subtitles, audio and compression
docs/demo-video-subtitled.mp4      Generated demo video (gitignored)
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
| Contract | `0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967` |
| Deployer | `0x3de43AA2f7162c80af98abe78222aE0Cdf83c506` |
| Runner pin | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Challenge window | 2 clock steps |
| Challenge bond | 50 PGT |
| Transactions recorded | 43 |

### Seeded markets

| Id | Question | Status | Outcome | Pot |
|---|---|---|---|---|
| 1 | Did EIP-7691 raise the Ethereum blob target to 6 and the maximum to 9 per b... | FINALIZED | OUTCOME_YES | 650 |
| 2 | Does the official openai python package metadata link to its GitHub reposit... | FINALIZED | OUTCOME_YES | 240 |
| 3 | Is the latest World Bank US GDP observation above 20 trillion US dollars? | FINALIZED | OUTCOME_YES | 200 |

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
| guard:premature_claim | `0x22b9bec877384605...` | ERROR | yes |
| guard:losing_claim | `0x26a6c0642b0e0560...` | ERROR | yes |
| guard:double_claim | `0xaedbccc038bf6a64...` | ERROR | yes |

| Consensus step | Status | Result | Agree votes |
|---|---|---|---|
| resolve:eth_blob | FINALIZED | MAJORITY_AGREE | 3/5 |
| audit:eth_blob | FINALIZED | MAJORITY_AGREE | 3/5 |
| resolve:macro_gdp | FINALIZED | MAJORITY_AGREE | 3/5 |

### Custody invariant after settlement

```
vault_custody_balance      = 800
locked_market_pots         = 800
active_challenge_bonds     = 0
expected_custody           = 800
delta                      = 0
invariant_ok               = True
total_volume               = 1840
total_paid_out             = 1090
```

### Four way sha256 identity

| Source | sha256 | Bytes |
|---|---|---|
| Local LF file | `186306f79ddf64f74b130b22a867152c2d0f5f429b3a2872b307f4e268a9ab7d` | 69073 |
| Git blob | `186306f79ddf64f74b130b22a867152c2d0f5f429b3a2872b307f4e268a9ab7d` | 69073 |
| On chain code | `186306f79ddf64f74b130b22a867152c2d0f5f429b3a2872b307f4e268a9ab7d` | 69073 |
| GitHub raw file | `None` | None |

Local equals git: yes. Local equals on chain: yes. All four equal: no.

### Local verification recorded with the evidence

- `genvm-lint check`: passed
- Direct tests: passed (80 passed, 0 failed)
- `80 passed in 2.30s`

<!-- EVIDENCE:END -->

## Security notes

- Expected business errors use the `[EXPECTED]` prefix, external 4xx errors use
  `[EXTERNAL]`, network and 5xx errors use `[TRANSIENT]`, and malformed model
  output uses `[LLM_ERROR]`. Deterministic prefixes are compared exactly during
  consensus.
- Evidence URLs must be public http or https, without credentials, path
  traversal, loopback, private ranges or IP literals.
- A challenge that never reaches consensus is not allowed to pick a winner. After
  the window plus one grace window, `finalize_market_settlement` converts the
  market to `OUTCOME_INVALID_REFUND`, returns the bond and refunds principal.
  This path can only refund, never pay a side.
- The token is a demo collateral ledger with an open faucet. It has no monetary
  value and is not a security.

## Limitations

- Studionet is a test network. Consensus results depend on validator web access
  to the cited sources.
- The LLM can return `UNDETERMINED`, in which case the transaction reverts and
  the market stays open. This is intentional: a malformed model response must
  never settle a market.
- The frontend caches nothing; every refresh is three live RPC calls.

## License

MIT.
