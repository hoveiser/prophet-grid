#!/usr/bin/env python3
"""Drive the bonded challenge and re-audit lifecycle on studionet.

Runs after scripts/deploy_studionet.py so the short challenge window of the
main scenario is not a timing hazard. It creates one more book, resolves it,
has a second desk post a bond and force a re-audit, then settles and claims.
Every step lands in the same checkpoint so the milestone evidence file records
the challenge path with its own transaction hashes and validator votes.

Usage:
    .venv/bin/python scripts/drive_challenge_lifecycle.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from deploy_studionet import CHECKPOINT, CHALLENGE_BOND, UNIT, Runner, log, save_json  # noqa: E402

QUESTION = (
    "Does the post Pectra blob target reach at least 5000 basis points of the per-block "
    "blob maximum?"
)
CATEGORY = "TECH"
CRITERIA = (
    "Report the blob target divided by the per-block blob maximum as an integer from 0 to 10000 "
    "basis points, so a target of 6 with a maximum of 9 is reported as 6667. Take the numbers only "
    "from the documents. Resolve YES at or above the strike plus the corridor, NO below the strike "
    "minus the corridor, and refund when the documents contradict each other."
)
PRIMARY = "https://eips.ethereum.org/EIPS/eip-7691"
SECONDARY = "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-7691.md"
COUNTER = "https://eips.ethereum.org/EIPS/eip-4844"

CLOSE_WINDOW_SHORT = 150
CHALLENGE_WINDOW_SHORT = 150
TIMEOUT_MARGIN_SHORT = 900


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

    runner.write("create:challenge_book", "create_market", [
        QUESTION, CATEGORY, PRIMARY, SECONDARY, CRITERIA, 5000, 1000,
        CLOSE_WINDOW_SHORT, CHALLENGE_WINDOW_SHORT, TIMEOUT_MARGIN_SHORT,
    ], account=runner.main)

    listing = runner.read_json("list_markets", [0, 20])
    market_id = None
    for row in listing["rows"]:
        if row["question"] == QUESTION:
            market_id = row["market_id"]
            break
    if market_id is None:
        print("the challenge book was not found on chain")
        return 2
    runner.checkpoint["markets"]["challenge_book"] = market_id
    save_json(CHECKPOINT, runner.checkpoint)
    log(f"challenge book is market {market_id}")

    runner.write("bet:challenge_book:alice", "buy_outcome_shares", [market_id, "YES", 12 * UNIT],
                 account=runner.burners["alice"])
    runner.write("bet:challenge_book:bob", "buy_outcome_shares", [market_id, "NO", 8 * UNIT],
                 account=runner.burners["bob"])

    row = runner.read_json("get_market", [market_id])
    runner.wait_until(row["close_epoch"], "challenge book close epoch")
    runner.write("resolve:challenge_book", "resolve_market_via_consensus", [market_id, PRIMARY],
                 account=runner.burners["carol"], attempts=2)

    runner.write("challenge:challenge_book", "file_resolution_challenge", [market_id, COUNTER],
                 account=runner.burners["bob"])
    runner.write("challenge_payable:challenge_book", "challenge_market_resolution_payable",
                 [market_id, COUNTER], account=runner.burners["carol"], value=2 * CHALLENGE_BOND)
    runner.write("audit:challenge_book", "audit_resolution_challenge", [market_id],
                 account=runner.burners["alice"], attempts=2, optional=True)

    row = runner.read_json("get_market", [market_id])
    if row["status"] == "CHALLENGED":
        log("the re-audit did not reach consensus, finalizing will abort the open challenge")
    runner.wait_until(row["challenge_deadline_epoch"], "challenge book deadline")
    runner.write("finalize:challenge_book", "finalize_market_settlement", [market_id], account=runner.main)

    settled = runner.read_json("get_market", [market_id])
    if settled["mode"] == "REFUND":
        runner.write("refund_band:challenge_book:alice", "claim_refund", [market_id], account=runner.burners["alice"])
    else:
        preview = runner.read_json("preview_payout", [market_id, runner.burners["alice"].address])
        if int(preview.get("estimated_payout") or 0) > 0:
            runner.write("claim:challenge_book:alice", "claim_market_winnings", [market_id],
                         account=runner.burners["alice"])
        runner.write("guard:double_claim:challenge_book", "claim_market_winnings", [market_id],
                     account=runner.burners["alice"], expect_error=True)

    final = runner.read_json("get_market", [market_id])
    log("challenge book final state " + str(final["status"]) + " band " + str(final["band"]))
    runner.build_evidence()
    return 0


if __name__ == "__main__":
    sys.exit(main())
