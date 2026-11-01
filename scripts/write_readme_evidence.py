#!/usr/bin/env python3
"""Inject the on chain evidence summary into README.md between the markers.

The evidence file is the only source of truth here: every number printed into
the README comes from evidence/studionet_Live_Milestone_v1.json, which is
itself written from transaction receipts.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
EVIDENCE = ROOT / "evidence" / "studionet_Live_Milestone_v1.json"
START = "<!-- EVIDENCE:START -->"
END = "<!-- EVIDENCE:END -->"


def tracked_commit() -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(ROOT), "log", "-1", "--format=%H", "--", "contracts/prophet_grid.py"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def pick(data: dict, path: str, default=None):
    cursor = data
    for part in path.split("."):
        if isinstance(cursor, list):
            try:
                cursor = cursor[int(part)]
            except (ValueError, IndexError):
                return default
        elif isinstance(cursor, dict) and part in cursor:
            cursor = cursor[part]
        else:
            return default
    return cursor if cursor is not None else default


def yes(value) -> str:
    return "yes" if value else "no"


def main() -> int:
    if not EVIDENCE.exists():
        print("evidence/studionet_Live_Milestone_v1.json is missing")
        return 2
    data = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    stats = data.get("platform_stats", {})
    vault = data.get("vault_invariants", {})
    custody = data.get("custody_accounting", {})
    identity = data.get("sha256_identity", {})
    checks = data.get("local_checks", {})
    proof = data.get("native_custody_proof", {})
    guards = data.get("guard_reverts", [])
    proofs = data.get("consensus_proofs", [])
    markets = data.get("markets", [])
    hedges = data.get("hedges", [])
    soft = data.get("soft_fail_proof", [])
    receipts = {row.get("market_id"): row for row in data.get("resolution_receipts", [])}

    lines: list[str] = []
    add = lines.append
    add("### Deployment")
    add("")
    add("| Item | Value |")
    add("|---|---|")
    add(f"| Contract | `{data.get('contract_address')}` |")
    add(f"| Network | {data.get('network')}, chain id {data.get('chain_id')} |")
    add(f"| RPC | `{data.get('rpc')}` |")
    add(f"| Deploy tx | `{data.get('deploy_tx')}` |")
    add(f"| Release tag | `{data.get('milestone')}` |")
    add(f"| Source commit | `{tracked_commit()[:12]}` |")
    add(f"| Constructor | close {data['constructor_args'][0]}s, challenge {data['constructor_args'][1]}s, "
        f"bond {data['constructor_args'][2]} wei |")
    add(f"| Contract sha256 | `{identity.get('local_lf_sha256')}` |")
    add(f"| Contract size | {identity.get('local_lf_bytes')} bytes |")
    add("")
    add("### Books settled on chain")
    add("")
    add("| Book | Category | Band | Print bps | YES bps | NO bps | Pot | Mode | Outcome |")
    add("|---|---|---|---|---|---|---|---|---|")
    for row in markets:
        market_id = str(row.get("market_id"))
        receipt = receipts.get(market_id, {})
        pot = int(row.get("pot") or 0)
        paid = int(row.get("yes_paid") or 0) + int(row.get("no_paid") or 0) + int(row.get("refund_paid") or 0)
        outcome = "paid out" if paid else ("awaiting settlement" if row.get("status") != "FINALIZED" else "settled")
        if int(row.get("refund_paid") or 0):
            outcome = "principal refunded"
        add(
            f"| PG:{market_id} | {row.get('category')} | `{row.get('band') or '-'}` | "
            f"{row.get('observed_bps')} | {row.get('yes_payout_bps')} | {row.get('no_payout_bps')} | "
            f"{pot} | {row.get('mode') or '-'} | {outcome} |"
        )
    add("")
    add("### Consensus proofs")
    add("")
    add("| Step | Tx | Result | Votes | Execution |")
    add("|---|---|---|---|---|")
    for entry in proofs:
        add(
            f"| `{entry.get('step')}` | `{str(entry.get('tx_hash'))[:20]}...` | {entry.get('result')} | "
            f"{entry.get('votes_agree')}/{entry.get('votes_total')} | {entry.get('execution')} |"
        )
    add("")
    add("### Guards that reverted on chain")
    add("")
    add("| Step | Tx | Execution | Reason returned by the leader |")
    add("|---|---|---|---|")
    for entry in guards:
        reason = str(entry.get("error") or "")[:96]
        add(
            f"| `{entry.get('step')}` | `{str(entry.get('tx_hash'))[:20]}...` | {entry.get('execution')} | "
            f"`{reason}` |"
        )
    add("")
    add("### Payable soft-fail and refund")
    add("")
    for entry in soft:
        detail = f"tx `{str(entry.get('tx_hash'))[:20]}...`" if entry.get("tx_hash") else "no value moved"
        extra = f" refundable after: {entry.get('refundable_after_soft_fail')}" if entry.get("refundable_after_soft_fail") else ""
        add(f"- `{entry.get('step')}` via `{entry.get('function')}` on {entry.get('account')}: {detail}{extra}")
    add("")
    add("### Hedge baskets")
    add("")
    if hedges:
        add("| Basket | Pair | Collateral | Reservation | State | Paid |")
        add("|---|---|---|---|---|---|")
        for row in hedges:
            add(
                f"| {row.get('hedge_id')} | PG:{row.get('primary_market_id')} {row.get('primary_side')} x "
                f"PG:{row.get('hedge_market_id')} {row.get('hedge_side')} | {row.get('collateral')} | "
                f"{row.get('reservation')} | {row.get('state')} | {row.get('paid')} |"
            )
    else:
        add("no baskets recorded")
    add("")
    add("### Custody accounting after the run")
    add("")
    add("| Term | Wei |")
    add("|---|---|")
    for label, key in (
        ("total supply", "total_supply"),
        ("wallet balances", "wallet_balances"),
        ("vault custody", "vault_custody_balance"),
        ("locked market pots", "locked_market_pots"),
        ("pending challenge bonds", "pending_challenge_bonds"),
        ("hedge reservations", "hedge_reservations"),
        ("refundable deposits", "refundable_native"),
        ("protocol fee reserve", "protocol_reserve"),
        ("native value held", "native_custody_balance"),
    ):
        add(f"| {label} | {vault.get(key, custody.get(key))} |")
    add("")
    add(f"- invariant identity holds: **{yes(vault.get('ok'))}**")
    add(f"- node reported native balance `{proof.get('contract_native_balance_wei')}` wei, contract accounting "
        f"reports `{proof.get('contract_reported_wei')}` wei")
    add(f"- lifetime volume {stats.get('total_volume')}, paid out {stats.get('total_paid_out')}, "
        f"refunded {stats.get('total_refunded')}, settled books {stats.get('settlement_count')}")
    add(f"- privileged roles reported by the contract: {stats.get('privileged_roles')}")
    add("")
    add("### Four way sha256 identity")
    add("")
    add("| Source | sha256 | Bytes | Match |")
    add("|---|---|---|---|")
    add(f"| local file with LF endings | `{identity.get('local_lf_sha256')}` | {identity.get('local_lf_bytes')} | "
        f"baseline |")
    add(f"| git blob at HEAD | `{identity.get('git_blob_sha256')}` | {identity.get('git_blob_bytes')} | "
        f"{yes(identity.get('match_local_git'))} |")
    add(f"| deployed studionet code | `{identity.get('onchain_sha256')}` | {identity.get('onchain_bytes')} | "
        f"{yes(identity.get('match_local_onchain'))} |")
    add(f"| GitHub raw main branch | `{identity.get('remote_github_sha256')}` | {identity.get('remote_github_bytes')} | "
        f"{yes(identity.get('match_local_remote'))} |")
    add("")
    add(f"All four identical: **{yes(identity.get('match_all_four'))}**")
    add("")
    add("### Local verification recorded with the evidence")
    add("")
    add(f"- `genvm-lint check contracts/prophet_grid.py` exit code {checks.get('lint_returncode')}: "
        f"{' '.join(checks.get('lint_output') or [])[:120]}")
    add(f"- `pytest tests/test_prophet_grid_direct.py -q` exit code {checks.get('tests_returncode')}: "
        f"{checks.get('tests_summary')}")
    add(f"- transactions recorded: {len(data.get('transactions', []))}, rejected consensus attempts: "
        f"{len(data.get('rejected_attempts', []))}")
    add(f"- evidence file: `evidence/studionet_Live_Milestone_v1.json`")

    block = "\n".join(lines)
    text = README.read_text(encoding="utf-8")
    start = text.index(START) + len(START)
    finish = text.index(END)
    updated = text[:start] + "\n\n" + block + "\n\n" + text[finish:]
    README.write_text(updated, encoding="utf-8")
    print(f"README evidence block refreshed ({len(lines)} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
