#!/usr/bin/env python3
"""Seed two extra markets for the interactive demo.

Market 4 is resolved live and intentionally left inside its challenge window
so the UI can demonstrate the premature claim guard and the challenge flow.
Market 5 stays open for trading so the simulator and buy flow have a target.

The script reuses the idempotent runner from deploy_studionet.py, so it can be
re-run safely and resumes from evidence/_checkpoint.json.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from deploy_studionet import CHECKPOINT, Runner, log, save_json  # noqa: E402

PROVISIONAL_MARKET = {
    "key": "demo_eip4844",
    "question": "Does EIP-4844 set the Ethereum blob target to 3 and the maximum to 6 per block?",
    "category": "TECH",
    "primary": "https://eips.ethereum.org/EIPS/eip-4844",
    "evidence": "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-4844.md",
    "criteria": (
        "Resolve YES when the EIP text states a blob target of 3 and a maximum of 6 per block. "
        "Resolve NO when it states different numbers."
    ),
}

OPEN_MARKET = {
    "key": "demo_cpi",
    "question": "Will the latest World Bank US inflation print stay below 5 percent?",
    "category": "MACRO",
    "primary": "https://api.worldbank.org/v2/country/USA/indicator/FP.CPI.TOTL.ZG?format=json&per_page=3",
    "evidence": "https://api.worldbank.org/v2/country/USA?format=json",
    "criteria": (
        "Resolve YES when the most recent annual US inflation value in the World Bank API is below 5 percent. "
        "Resolve NO when it is at or above 5 percent."
    ),
}


def main() -> int:
    load_dotenv(ROOT / ".env")
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "")
    if not key:
        print("GENLAYER_PRIVATE_KEY is missing from .env")
        return 2
    if not key.startswith("0x"):
        key = "0x" + key

    runner = Runner(key)
    if not runner.address:
        print("no deployment in the checkpoint, run deploy_studionet.py first")
        return 2

    alice = runner.burners["alice"]
    bob = runner.burners["bob"]

    # Market 4: resolved and left inside the challenge window.
    key_provisional = f"market:{PROVISIONAL_MARKET['key']}"
    if not runner.done(key_provisional):
        runner.write(
            key_provisional,
            runner.address,
            "create_market",
            [
                PROVISIONAL_MARKET["question"],
                PROVISIONAL_MARKET["category"],
                PROVISIONAL_MARKET["primary"],
                PROVISIONAL_MARKET["criteria"],
            ],
            account=runner.main,
        )
        provisional_id = int(runner.read_scalar("get_market_count"))
        entry = runner.step(key_provisional)
        entry["market_id"] = provisional_id
        runner.checkpoint["steps"][key_provisional] = entry
        runner.checkpoint["markets"][PROVISIONAL_MARKET["key"]] = provisional_id
        save_json(CHECKPOINT, runner.checkpoint)
        log(f"demo market {PROVISIONAL_MARKET['key']} created with id {provisional_id}")
    else:
        provisional_id = runner.step(key_provisional)["market_id"]
        log(f"demo market {PROVISIONAL_MARKET['key']} already exists with id {provisional_id}")

    runner.write("trade:demo_eip4844:alice:YES", runner.address, "buy_outcome_shares", [provisional_id, "YES", 250], account=alice)
    runner.write("trade:demo_eip4844:bob:NO", runner.address, "buy_outcome_shares", [provisional_id, "NO", 150], account=bob)
    runner.write(
        "resolve:demo_eip4844",
        runner.address,
        "resolve_market_live",
        [provisional_id, PROVISIONAL_MARKET["evidence"]],
        account=alice,
    )

    # Market 5: stays open for trading.
    key_open = f"market:{OPEN_MARKET['key']}"
    if not runner.done(key_open):
        runner.write(
            key_open,
            runner.address,
            "create_market",
            [
                OPEN_MARKET["question"],
                OPEN_MARKET["category"],
                OPEN_MARKET["primary"],
                OPEN_MARKET["criteria"],
            ],
            account=runner.main,
        )
        open_id = int(runner.read_scalar("get_market_count"))
        entry = runner.step(key_open)
        entry["market_id"] = open_id
        runner.checkpoint["steps"][key_open] = entry
        runner.checkpoint["markets"][OPEN_MARKET["key"]] = open_id
        save_json(CHECKPOINT, runner.checkpoint)
        log(f"demo market {OPEN_MARKET['key']} created with id {open_id}")
    else:
        open_id = runner.step(key_open)["market_id"]
        log(f"demo market {OPEN_MARKET['key']} already exists with id {open_id}")

    runner.write("trade:demo_cpi:alice:YES", runner.address, "buy_outcome_shares", [open_id, "YES", 180], account=alice)
    runner.write("trade:demo_cpi:bob:NO", runner.address, "buy_outcome_shares", [open_id, "NO", 220], account=bob)

    state = runner.read_json("get_market", [provisional_id])
    log(
        "demo market %s status=%s phase=%s window=%s steps"
        % (provisional_id, state.get("status"), state.get("phase"), state.get("countdown_steps"))
    )
    stats = runner.read_json("get_platform_stats")
    log("platform markets=%s tvl=%s invariant_ok=%s" % (stats.get("total_markets"), stats.get("tvl"), stats.get("invariant_ok")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
