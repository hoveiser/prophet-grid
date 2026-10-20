#!/usr/bin/env python3
"""Inject the on chain evidence summary into README.md between markers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
EVIDENCE = ROOT / "evidence" / "studionet_deployment.json"
START = "<!-- EVIDENCE:START -->"
END = "<!-- EVIDENCE:END -->"


def tracked_commit() -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(ROOT), "log", "-1", "--format=%H", "--", "contracts/prophet_grid.py"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def deploy_tx(data: dict) -> str:
    for item in data.get("transactions", []):
        if item.get("step") == "deploy" and item.get("tx_hash"):
            return str(item["tx_hash"])
    return "unknown"


def yes(value: bool) -> str:
    return "yes" if value else "no"


def main() -> int:
    if not EVIDENCE.exists():
        print("evidence/studionet_deployment.json is missing")
        return 2
    data = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    stats = data.get("platform_stats", {})
    invariants = data.get("vault_invariants", {})
    identity = data.get("sha256_identity", {})
    checks = data.get("local_checks", {})
    guards = data.get("guard_reverts", [])
    proofs = data.get("consensus_proofs", [])
    markets = data.get("markets", [])
    signers = data.get("signers", {})

    lines = []
    lines.append("### Deployment")
    lines.append("")
    lines.append("| Field | Value |")
    lines.append("|---|---|")
    lines.append(f"| Network | studionet (chain {data.get('chain_id')}) |")
    lines.append(f"| Contract | `{data.get('contract_address')}` |")
    lines.append(f"| Deployer | `{data.get('deployer')}` |")
    lines.append(f"| Deploy transaction | `{deploy_tx(data)}` |")
    lines.append(f"| Contract commit | `{tracked_commit()}` |")
    lines.append("| Tag | `studionet-v1` |")
    lines.append(f"| Runner pin | `{data.get('runner_pin')}` |")
    lines.append(f"| Challenge window | {data.get('challenge_window_steps')} clock steps |")
    lines.append(f"| Challenge bond | {data.get('challenge_bond_amount')} PGT |")
    lines.append(f"| Transactions recorded | {len(data.get('transactions', []))} |")
    lines.append("")

    lines.append("### Seeded markets")
    lines.append("")
    lines.append("| Id | Question | Status | Outcome | Pot |")
    lines.append("|---|---|---|---|---|")
    for market in markets:
        question = str(market.get("question", "")).replace("|", "/")
        if len(question) > 78:
            question = question[:75] + "..."
        lines.append(
            f"| {market.get('market_id')} | {question} | {market.get('status')} | "
            f"{market.get('outcome_band')} | {market.get('total_pot')} |"
        )
    lines.append("")

    lines.append("### Signers")
    lines.append("")
    lines.append("| Role | Address |")
    lines.append("|---|---|")
    for role, address in signers.items():
        lines.append(f"| {role} | `{address}` |")
    lines.append("")

    lines.append("### Guards and consensus")
    lines.append("")
    lines.append("| Guard | Transaction | Execution | Matched |")
    lines.append("|---|---|---|---|")
    for guard in guards:
        lines.append(
            f"| {guard.get('step')} | `{str(guard.get('tx_hash'))[:18]}...` | {guard.get('execution')} | "
            f"{yes(bool(guard.get('matched')))} |"
        )
    lines.append("")
    lines.append("| Consensus step | Status | Result | Agree votes |")
    lines.append("|---|---|---|---|")
    for proof in proofs:
        lines.append(
            f"| {proof.get('step')} | {proof.get('status')} | {proof.get('result')} | "
            f"{proof.get('votes_agree')}/{proof.get('votes_total')} |"
        )
    lines.append("")

    lines.append("### Custody invariant after settlement")
    lines.append("")
    lines.append("```")
    lines.append(f"vault_custody_balance      = {invariants.get('vault_custody_balance')}")
    lines.append(f"locked_market_pots         = {invariants.get('locked_market_pots')}")
    lines.append(f"active_challenge_bonds     = {invariants.get('active_challenge_bonds')}")
    lines.append(f"expected_custody           = {invariants.get('expected_custody')}")
    lines.append(f"delta                      = {invariants.get('delta')}")
    lines.append(f"invariant_ok               = {invariants.get('ok')}")
    lines.append(f"total_volume               = {stats.get('total_volume')}")
    lines.append(f"total_paid_out             = {stats.get('total_paid_out')}")
    lines.append("```")
    lines.append("")

    lines.append("### Four way sha256 identity")
    lines.append("")
    lines.append("| Source | sha256 | Bytes |")
    lines.append("|---|---|---|")
    lines.append(f"| Local LF file | `{identity.get('local_lf_sha256')}` | {identity.get('local_lf_bytes')} |")
    lines.append(f"| Git blob | `{identity.get('git_blob_sha256')}` | {identity.get('git_blob_bytes')} |")
    lines.append(f"| On chain code | `{identity.get('onchain_sha256')}` | {identity.get('onchain_bytes')} |")
    lines.append(f"| GitHub raw file | `{identity.get('remote_github_sha256')}` | {identity.get('remote_github_bytes')} |")
    lines.append("")
    lines.append(
        f"Local equals git: {yes(bool(identity.get('match_local_git')))}. "
        f"Local equals on chain: {yes(bool(identity.get('match_local_onchain')))}. "
        f"All four equal: {yes(bool(identity.get('match_all_four')))}."
    )
    lines.append("")

    lines.append("### Local verification recorded with the evidence")
    lines.append("")
    lines.append(f"- `genvm-lint check`: {checks.get('lint')}")
    lines.append(f"- Direct tests: {checks.get('tests')} ({checks.get('tests_passed')} passed, {checks.get('tests_failed')} failed)")
    lines.append(f"- `{checks.get('tests_summary')}`")
    lines.append("")

    block = "\n".join(lines)
    text = README.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print("README evidence markers are missing")
        return 2
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    README.write_text(f"{before}{START}\n\n{block}\n{END}{after}", encoding="utf-8")
    print(f"updated {README.relative_to(ROOT)} with {len(lines)} evidence lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
