#!/usr/bin/env python3
"""Deploy ProphetGrid Flagship v1 to GenLayer studionet and run the live lifecycle.

The script is idempotent: every step is written to evidence/_checkpoint_v1.json
and skipped on a rerun. It records transaction hashes, consensus vote counts,
guard reverts, payable soft-fail refunds, the custody proof and the four way
sha256 identity in evidence/studionet_Live_Milestone_v1.json.

Usage:
    .venv/bin/python scripts/deploy_studionet.py
    .venv/bin/python scripts/deploy_studionet.py --deploy-only
    .venv/bin/python scripts/deploy_studionet.py --evidence-only
    .venv/bin/python scripts/deploy_studionet.py --status
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3

from genlayer_py import create_account, create_client, studionet

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "prophet_grid.py"
EVIDENCE_DIR = ROOT / "evidence"
EVIDENCE_FILE = EVIDENCE_DIR / "studionet_Live_Milestone_v1.json"
CHECKPOINT = EVIDENCE_DIR / "_checkpoint_v1.json"
ARTIFACTS = ROOT / "artifacts"

RPC_URL = studionet.rpc_urls["default"]["http"][0]
CHAIN_ID = studionet.id
TAG = "milestone-v1"
POLITE_DELAY = 2.0
TERMINAL_STATUSES = ("FINALIZED", "FAILED", "CANCELED", "ERROR")
BURNER_FUND_WEI = 2 * 10 ** 18
UNIT = 10 ** 15

# Contract constructor parameters and the windows the scenario relies on. Each
# market is created immediately before its own bets so the intake window is
# never exhausted by transport latency.
CLOSE_WINDOW = 300
CHALLENGE_WINDOW = 120
CHALLENGE_BOND = 10 * UNIT
TIMEOUT_MARGIN = 900

MARKETS = [
    {
        "key": "ecb_easing",
        "skip_resolve": True,
        "question": (
            "Did the published ECB deposit facility rate for the reference month stand at or "
            "above 2500 basis points of the 10000 basis point policy corridor?"
        ),
        "category": "MACRO",
        "criteria": (
            "Report the deposit facility rate as an integer from 0 to 10000 basis points of a "
            "10 percent policy corridor, so a rate of 3 percent is 3000. Use only figures printed "
            "in the documents. Resolve YES above the strike plus the corridor, NO below the strike "
            "minus the corridor, and refund when the two sources cannot be reconciled."
        ),
        "primary": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html",
        "secondary": "https://www.bis.org/statistics/interestrates.htm",
        "counter": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        "strike": 2500,
        "corridor": 1000,
        "bets": [("alice", "YES", 30), ("carol", "NO", 20)],
        "note": (
            "The secondary source returns a node level load failure, so consensus can never be "
            "reached for this book. It is kept on purpose: after the resolution timeout the desk "
            "principal is refunded through claim_refund, proving the timeout recovery path."
        ),
    },
    {
        "key": "blob_ratio",
        "question": (
            "Does the EIP-4844 blob target sit at or above 2500 basis points of the per-block "
            "blob maximum?"
        ),
        "category": "TECH",
        "criteria": (
            "Report the blob target divided by the per-block blob maximum as an integer from 0 to "
            "10000 basis points, so a target of 3 with a maximum of 6 is reported as 5000. Take the "
            "numbers only from the documents. Resolve YES when the print is at or above the strike "
            "plus the corridor, NO when it is below the strike minus the corridor, and refund when "
            "the documents contradict each other."
        ),
        "primary": "https://eips.ethereum.org/EIPS/eip-4844",
        "secondary": "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-4844.md",
        "counter": "https://eips.ethereum.org/EIPS/eip-7691",
        "strike": 2500,
        "corridor": 1000,
        "bets": [("alice", "YES", 25), ("bob", "NO", 15)],
        "note": "Two independent hosts carrying the same specification, so the YES band is stable.",
    },
    {
        "key": "py_floor",
        "question": (
            "Does the minimum supported Python version of the requests package sit inside the "
            "scalar corridor of its strike?"
        ),
        "category": "AI",
        "criteria": (
            "Report the minimum supported Python version as an integer from 0 to 10000 by taking "
            "the minor version number and multiplying it by 1000, so Python 3.8 is reported as "
            "8000 and Python 3.7 as 7000. Use only the requires-python field printed in the "
            "documents."
        ),
        "primary": "https://pypi.org/pypi/requests/json",
        "secondary": "https://raw.githubusercontent.com/psf/requests/main/pyproject.toml",
        "counter": "https://pypi.org/pypi/urllib3/json",
        "strike": 7500,
        "corridor": 2500,
        "bets": [("bob", "YES", 20), ("carol", "NO", 40)],
        "note": "The print falls inside the corridor, so this book exercises the scalar split band.",
    },
    {
        "key": "blob_conflict",
        "question": (
            "Does the post Pectra blob target reach 7500 basis points of the per-block maximum?"
        ),
        "category": "CRYPTO",
        "criteria": (
            "Report the blob target divided by the per-block blob maximum as an integer from 0 to "
            "10000 basis points, so a target of 3 with a maximum of 6 is 5000 and a target of 6 "
            "with a maximum of 9 is 6667. Take the numbers only from the documents."
        ),
        "primary": "https://eips.ethereum.org/EIPS/eip-4844",
        "secondary": "https://eips.ethereum.org/EIPS/eip-7691",
        "counter": "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-7691.md",
        "strike": 7500,
        "corridor": 1000,
        "bets": [("alice", "YES", 12), ("carol", "NO", 18)],
        "note": (
            "The two sources describe different upgrades, so the extracted prints are more than one "
            "grid step apart. The contract must therefore settle INVALID_OR_AMBIGUOUS_REFUND and "
            "refund both desks in full."
        ),
    },
]


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (ValueError, OSError):
        return default


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    os.replace(temp, path)


def leader_execution(receipt: dict) -> str | None:
    consensus = receipt.get("consensus_data") or {}
    leader = consensus.get("leader_receipt") or []
    if isinstance(leader, dict):
        leader = [leader]
    for item in leader:
        if isinstance(item, dict) and item.get("mode") == "leader" and item.get("execution_result"):
            return item.get("execution_result")
    for item in leader:
        if isinstance(item, dict) and item.get("execution_result"):
            return item.get("execution_result")
    return None


def leader_error(receipt: dict) -> str | None:
    """Extract the revert payload the leader returned, when there is one."""
    import ast

    consensus = receipt.get("consensus_data") or {}
    leader = consensus.get("leader_receipt") or []
    if isinstance(leader, dict):
        leader = [leader]
    for item in leader:
        if not isinstance(item, dict):
            continue
        raw = item.get("result")
        payload = None
        if isinstance(raw, dict):
            payload = raw.get("payload")
        elif isinstance(raw, str):
            try:
                parsed = ast.literal_eval(raw)
            except (ValueError, SyntaxError):
                parsed = None
            if isinstance(parsed, dict):
                payload = parsed.get("payload")
        if payload:
            return str(payload)[:400]
    return None


def vote_summary(receipt: dict) -> dict:
    votes = ((receipt.get("consensus_data") or {}).get("votes")) or {}
    agree = sum(1 for value in votes.values() if str(value).lower() == "agree")
    disagree = sum(1 for value in votes.values() if str(value).lower() == "disagree")
    return {"agree": agree, "disagree": disagree, "total": len(votes), "votes": votes}


class StepFailed(RuntimeError):
    pass


def retryable(exc: Exception) -> bool:
    text = str(exc).lower()
    markers = ("429", "rate limit", "too many requests", "timeout", "timed out", "connection",
               "temporarily unavailable", "502", "503", "504", "reset by peer", "remote end closed")
    return any(marker in text for marker in markers)


def with_retries(fn, label: str, attempts: int = 10, base_delay: float = 3.0):
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - transport retries are intentional
            if not retryable(exc) or attempt == attempts:
                raise
            log(f"retry {attempt}/{attempts - 1} for {label} after {type(exc).__name__}: {str(exc)[:120]}")
            time.sleep(base_delay * attempt)
    raise StepFailed(f"{label} failed")


def decode_contract_code(value) -> bytes:
    """Decode the code payload returned by gen_getContractCode."""
    if isinstance(value, bytes):
        raw = value
    elif isinstance(value, str):
        text = value.strip()
        raw = None
        if text.startswith("0x"):
            try:
                raw = bytes.fromhex(text[2:])
            except ValueError:
                raw = None
        if raw is None:
            try:
                candidate = base64.b64decode(text, validate=True)
            except Exception:
                candidate = b""
            raw = candidate if candidate.startswith(b"# {") else text.encode("utf-8")
    else:
        raw = b""
    return normalize_lf(raw)


def derive_burner_key(master_key: str, index: int) -> str:
    seed = f"prophet-grid-flagship-v1:{index}:{master_key.lower()}"
    return "0x" + bytes(Web3.keccak(text=seed)).hex()


def git_blob_sha(root: Path) -> tuple[str | None, int]:
    try:
        obj = subprocess.run(
            ["git", "rev-parse", f"HEAD:contracts/prophet_grid.py"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        data = subprocess.run(
            ["git", "cat-file", "blob", obj], cwd=str(root), capture_output=True, check=True
        ).stdout
        return sha256_hex(data), len(data)
    except Exception:
        return None, 0


def run_local_checks() -> dict:
    lint = subprocess.run(
        [str(ROOT / ".venv" / "bin" / "genvm-lint"), "check", str(CONTRACT)],
        cwd=str(ROOT), capture_output=True, text=True,
    )
    tests = subprocess.run(
        [str(ROOT / ".venv" / "bin" / "pytest"), "tests/test_prophet_grid_direct.py", "-q"],
        cwd=str(ROOT), capture_output=True, text=True, timeout=900,
    )
    summary = (tests.stdout or "").strip().splitlines()[-1] if tests.stdout else ""
    return {
        "lint_returncode": lint.returncode,
        "lint_output": (lint.stdout or lint.stderr or "").strip().splitlines()[:4],
        "tests_returncode": tests.returncode,
        "tests_summary": summary,
    }


class Runner:
    def __init__(self, main_key: str):
        self.main = create_account(main_key)
        self.client = create_client(chain=studionet, account=self.main)
        self.w3 = Web3(Web3.HTTPProvider(RPC_URL))
        self.checkpoint = load_json(CHECKPOINT, {})
        self.checkpoint.setdefault("steps", {})
        self.checkpoint.setdefault("transactions", [])
        self.checkpoint.setdefault("attempts", [])
        self.checkpoint.setdefault("markets", {})
        self.burners = {
            name: create_account(derive_burner_key(main_key, index))
            for index, name in enumerate(("alice", "bob", "carol"), start=1)
        }
        self.address = self.checkpoint.get("contract_address")

    # ------------------------------------------------------------ plumbing

    def done(self, key: str) -> bool:
        return key in self.checkpoint["steps"]

    def step(self, key: str) -> dict:
        return self.checkpoint["steps"][key]

    def record(self, key: str, entry: dict) -> dict:
        self.checkpoint["steps"][key] = entry
        self.checkpoint["transactions"] = [
            item for item in self.checkpoint["transactions"] if item.get("step") != key
        ]
        self.checkpoint["transactions"].append({
            "step": key,
            "tx_hash": entry.get("tx_hash"),
            "function": entry.get("function"),
            "account": entry.get("account"),
            "status": entry.get("status"),
            "result": entry.get("result"),
            "execution": entry.get("execution"),
            "votes_agree": entry.get("votes_agree"),
            "votes_total": entry.get("votes_total"),
        })
        save_json(CHECKPOINT, self.checkpoint)
        return entry

    def wait_final(self, tx_hash: str, timeout: int = 1800) -> dict:
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                receipt = self.client.get_transaction(tx_hash)
            except Exception as exc:  # noqa: BLE001 - network jitter
                if retryable(exc):
                    time.sleep(5)
                    continue
                raise
            last = str(receipt.get("status_name") or "") or last
            if last in TERMINAL_STATUSES:
                return receipt
            time.sleep(5)
        raise StepFailed(f"transaction {tx_hash} did not finalize, last status {last}")

    @staticmethod
    def summarize(tx_hash, receipt: dict, function_name: str, account: str) -> dict:
        votes = vote_summary(receipt)
        return {
            "tx_hash": tx_hash if isinstance(tx_hash, str) else tx_hash.hex(),
            "function": function_name,
            "account": account,
            "status": receipt.get("status_name"),
            "result": receipt.get("result_name"),
            "execution": leader_execution(receipt),
            "error": leader_error(receipt),
            "votes_agree": votes["agree"],
            "votes_disagree": votes["disagree"],
            "votes_total": votes["total"],
            "recorded_at": now_iso(),
        }

    def write(self, key: str, function_name: str, args: list, account=None, value: int = 0,
              expect_error: bool = False, attempts: int = 1, optional: bool = False) -> dict:
        if self.done(key):
            entry = self.step(key)
            log(f"skip {key} (recorded {str(entry.get('tx_hash'))[:18]})")
            return entry
        signer = account or self.main
        last = None
        for attempt in range(1, attempts + 1):
            log(f"write {key} -> {function_name} as {signer.address[:10]} value={value} attempt {attempt}/{attempts}")

            def submit():
                return self.client.write_contract(
                    address=self.address, function_name=function_name, args=args,
                    account=signer, value=value,
                )

            tx_hash = with_retries(submit, f"submit {key}")
            receipt = self.wait_final(tx_hash)
            entry = self.summarize(tx_hash, receipt, function_name, signer.address)
            last = entry
            finalized = entry.get("status") == "FINALIZED"
            success = entry.get("execution") == "SUCCESS"
            majority = entry.get("result") == "MAJORITY_AGREE"

            if expect_error:
                entry["expected_revert"] = True
                entry["matched_expected_revert"] = finalized and entry.get("execution") == "ERROR"
                if not entry["matched_expected_revert"]:
                    log(f"WARNING {key} was expected to revert but ended {entry.get('status')} {entry.get('result')}")
                self.record(key, entry)
                time.sleep(POLITE_DELAY)
                return entry
            if finalized and majority and success:
                self.record(key, entry)
                time.sleep(POLITE_DELAY)
                return entry
            self.checkpoint["attempts"].append(dict(entry, step=key, attempt=attempt))
            save_json(CHECKPOINT, self.checkpoint)
            save_json(ARTIFACTS / f"failed_{key.replace(':', '_')}.json", receipt)
            log(f"{key} not accepted: {entry.get('status')} {entry.get('result')} {entry.get('execution')} {str(entry.get('error'))[:160]}")
            if attempt < attempts:
                time.sleep(20)
        if optional:
            log(f"OPTIONAL step {key} did not reach consensus, the contract kept the prior state")
            return dict(last or {}, skipped=True)
        raise StepFailed(f"{key} was not accepted after {attempts} attempts")

    def read_json(self, function_name: str, args: list | None = None):
        value = self.read_scalar(function_name, args)
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        if isinstance(value, str):
            return json.loads(value)
        return value

    def read_scalar(self, function_name: str, args: list | None = None):
        def call():
            return self.client.read_contract(
                address=self.address, function_name=function_name, args=args or []
            )

        return with_retries(call, f"read {function_name}")

    @staticmethod
    def extract_contract_address(receipt: dict) -> str | None:
        for key in ("recipient", "to_address", "contract_address"):
            value = receipt.get(key)
            if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                if value.lower() != "0x" + "0" * 40:
                    return value
        groups = []
        consensus = receipt.get("consensus_data") or {}
        leader = consensus.get("leader_receipt") or []
        groups.append(leader if isinstance(leader, list) else [leader])
        decoded = receipt.get("tx_data_decoded") or {}
        if isinstance(decoded, dict):
            groups.append([decoded])
        for bundle in groups:
            for item in bundle:
                if not isinstance(item, dict):
                    continue
                for key in ("contract_address", "address", "recipient", "to"):
                    value = item.get(key)
                    if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                        return value
        return None

    def wait_until(self, epoch: int, label: str) -> None:
        """Wait for real time to pass a deterministic window boundary."""
        target = int(epoch) + 3
        remaining = target - int(time.time())
        if remaining <= 0:
            return
        log(f"waiting {remaining}s of wall clock for {label} (epoch {target})")
        while remaining > 0:
            time.sleep(min(20, max(1, remaining)))
            remaining = target - int(time.time())

    # ------------------------------------------------------------ steps

    def ensure_deployed(self) -> str:
        if self.address:
            try:
                stats = self.read_json("get_platform_stats")
                log(f"reusing deployment {self.address} with {stats.get('total_markets')} markets")
                return self.address
            except Exception as exc:  # noqa: BLE001 - stale checkpoint
                log(f"checkpoint address unusable: {type(exc).__name__}: {str(exc)[:120]}")
        if self.done("deploy"):
            self.address = self.step("deploy").get("contract_address")
            if self.address:
                return self.address
        code = CONTRACT.read_text(encoding="utf-8")
        log("deploying Flagship v1 to studionet")
        tx_hash = with_retries(
            lambda: self.client.deploy_contract(
                code=code, account=self.main, args=[CLOSE_WINDOW, CHALLENGE_WINDOW, CHALLENGE_BOND]
            ),
            "deploy",
        )
        receipt = self.wait_final(tx_hash)
        address = self.extract_contract_address(receipt)
        if not address:
            save_json(ARTIFACTS / "deploy_receipt_v1.json", receipt)
            raise StepFailed("could not read the contract address from the deploy receipt")
        self.address = address
        entry = self.summarize(tx_hash, receipt, "__deploy__", self.main.address)
        entry["contract_address"] = address
        self.record("deploy", entry)
        self.checkpoint["contract_address"] = address
        save_json(CHECKPOINT, self.checkpoint)
        log(f"deployed at {address}")
        return address

    def fund_burners(self) -> None:
        for name, account in self.burners.items():
            key = f"fund:{name}"
            if self.done(key):
                continue
            balance = self.w3.eth.get_balance(account.address)
            if balance >= BURNER_FUND_WEI:
                self.record(key, {"tx_hash": None, "function": "native_fund", "already_funded": True,
                                  "balance_wei": str(balance), "account": account.address,
                                  "status": "FINALIZED", "execution": "SUCCESS",
                                  "recorded_at": now_iso()})
                log(f"{name} already holds native value")
                continue
            log(f"funding {name} with 2 GEN")
            nonce = self.w3.eth.get_transaction_count(self.main.address)
            gas_price = self.w3.eth.gas_price
            tx = {
                "nonce": nonce, "to": account.address, "value": BURNER_FUND_WEI, "gas": 21000,
                "maxFeePerGas": gas_price, "maxPriorityFeePerGas": gas_price, "chainId": CHAIN_ID,
                "type": 2,
            }
            signed = self.main.sign_transaction(tx)
            raw = signed.raw_transaction.hex()
            if not raw.startswith("0x"):
                raw = "0x" + raw
            tx_hash = with_retries(
                lambda: self.client.provider.make_request("eth_sendRawTransaction", [raw]).get("result"),
                f"fund {name}",
            )
            deadline = time.time() + 240
            balance = 0
            while time.time() < deadline:
                balance = self.w3.eth.get_balance(account.address)
                if balance >= BURNER_FUND_WEI:
                    break
                time.sleep(5)
            if balance < BURNER_FUND_WEI:
                raise StepFailed(f"funding {name} did not land")
            self.record(key, {"tx_hash": tx_hash, "function": "native_fund", "account": account.address,
                              "balance_wei": str(balance), "status": "FINALIZED",
                              "execution": "SUCCESS", "result": "NATIVE", "recorded_at": now_iso()})

    def deposit_desks(self) -> None:
        for name, account in self.burners.items():
            self.write(f"deposit:{name}", "fund_pgt_vault_payable", [], account=account, value=200 * UNIT)

    def prove_soft_fail_refund(self) -> None:
        """Rule 8 on chain: an invalid payable call parks value and is then claimable."""
        account = self.burners["bob"]
        entry = self.write("soft_fail:short_bond", "fund_pgt_vault_payable", [], account=account, value=10 ** 12)
        entry["refundable_after_soft_fail"] = str(self.read_scalar("get_refundable_balance", [account.address]))
        self.record("soft_fail:short_bond", entry)
        self.write("refund:claim", "withdraw_refund", [10 ** 30], account=account)

    def prepare_markets(self) -> dict:
        """Create, probe the intake guard and seed depth for every book in turn."""
        markets: dict = {}
        for index, market in enumerate(MARKETS):
            key = market["key"]
            create_key = f"create:{key}"
            if not self.done(create_key):
                self.write(create_key, "create_market", [
                    market["question"], market["category"], market["primary"], market["secondary"],
                    market["criteria"], market["strike"], market["corridor"],
                    CLOSE_WINDOW, CHALLENGE_WINDOW, TIMEOUT_MARGIN,
                ], account=self.main)
            market_id = self.checkpoint["markets"].get(key)
            if market_id is None:
                listing = self.read_json("list_markets", [0, 20])
                match = None
                for candidate in listing["rows"]:
                    if candidate["question"] == market["question"]:
                        match = candidate["market_id"]
                        break
                if match is None:
                    raise StepFailed(f"cannot find the market id for {key}")
                market_id = match
                self.checkpoint["markets"][key] = market_id
                save_json(CHECKPOINT, self.checkpoint)
            markets[key] = market_id

            if index == 0:
                self.write("guard:resolve_before_close", "resolve_market_via_consensus",
                           [market_id, market["primary"]], account=self.burners["carol"], expect_error=True)
            self.write("guard:unknown_market", "buy_outcome_shares", ["999", "YES", UNIT],
                       account=self.burners["alice"], expect_error=True)
            if index == 0:
                self.write("guard:zero_transfer", "transfer_tokens", [self.burners["alice"].address, 0],
                           account=self.burners["alice"], expect_error=True)

            row = self.read_json("get_market", [market_id])
            if int(row["now"]) >= int(row["close_epoch"]) - 45:
                log(f"{key} intake window is nearly closed, waiting for a fresh book")
            for name, side, units in market["bets"]:
                self.write(f"bet:{key}:{name}", "buy_outcome_shares",
                           [market_id, side, units * UNIT], account=self.burners[name])
            if index == 1:
                self.write("bet:payable:carol", "acquire_outcome_shares_payable", [market_id, "NO"],
                           account=self.burners["carol"], value=10 * UNIT)
        return markets

    def resolve_all(self, markets: dict) -> None:
        for market in MARKETS:
            key = market["key"]
            market_id = markets[key]
            row = self.read_json("get_market", [market_id])
            if row["status"] != "OPEN":
                log(f"market {key} already {row['status']}")
                continue
            if market.get("skip_resolve"):
                log(f"market {key} is intentionally unresolvable, waiting for the timeout refund")
                continue
            self.wait_until(row["close_epoch"], f"{key} close epoch")
            self.write(f"resolve:{key}", "resolve_market_via_consensus", [market_id, market["primary"]],
                       account=self.burners["alice"], attempts=2, optional=True)

    def refund_timeouts(self, markets: dict) -> None:
        """Rule 10 live proof: an unsettled book returns every desk principal."""
        for market in MARKETS:
            key = market["key"]
            market_id = markets[key]
            row = self.read_json("get_market", [market_id])
            if row["status"] in ("FINALIZED", "REFUNDED"):
                continue
            self.wait_until(row["resolution_timeout_epoch"], f"{key} resolution timeout")
            for name, side, units in market["bets"]:
                step = f"refund_timeout:{key}:{name}"
                if self.done(step):
                    continue
                shares = self.read_json("preview_payout", [market_id, self.burners[name].address])
                if int(shares.get("principal") or 0) <= 0:
                    log(f"{key}/{name} holds no principal, nothing to refund")
                    continue
                self.write(step, "claim_refund", [market_id], account=self.burners[name])

    def challenge_and_audit(self, markets: dict) -> None:
        key = MARKETS[1]["key"]
        market_id = markets[key]
        row = self.read_json("get_market", [market_id])
        if row["status"] == "PROVISIONAL" and row["can_challenge"]:
            self.write(f"challenge:{key}", "file_resolution_challenge", [market_id, MARKETS[1]["counter"]],
                       account=self.burners["bob"])
            row = self.read_json("get_market", [market_id])
        if row["status"] == "CHALLENGED":
            self.write(f"audit:{key}", "audit_resolution_challenge", [market_id],
                       account=self.burners["carol"], attempts=2, optional=True)

    def open_hedge(self, markets: dict) -> None:
        primary = markets[MARKETS[1]["key"]]
        hedge = markets[MARKETS[2]["key"]]
        reservation = 4 * CHALLENGE_BOND
        self.write("hedge:open", "open_conditional_hedge_basket",
                   [primary, hedge, "YES", "NO", reservation], account=self.burners["alice"])
        self.write("hedge:open_payable", "open_conditional_hedge_payable",
                   [primary, hedge, "NO", "YES"], account=self.burners["bob"], value=6 * CHALLENGE_BOND)

    def settle_all(self, markets: dict) -> None:
        for market in MARKETS:
            key = market["key"]
            market_id = markets[key]
            row = self.read_json("get_market", [market_id])
            if row["status"] not in ("PROVISIONAL", "CHALLENGED"):
                log(f"market {key} is {row['status']}, nothing to finalize")
                continue
            self.wait_until(row["challenge_deadline_epoch"], f"{key} challenge deadline")
            self.write(f"finalize:{key}", "finalize_market_settlement", [market_id], account=self.main)
            settled = self.read_json("get_market", [market_id])
            if settled["mode"] == "REFUND":
                log(f"{key} settled in refund mode, returning principals")
                for name, side, units in market["bets"]:
                    self.write(f"refund_band:{key}:{name}", "claim_refund", [market_id],
                               account=self.burners[name])
                continue
            claimed = None
            for name, side, units in market["bets"]:
                account = self.burners[name]
                preview = self.read_json("preview_payout", [market_id, account.address])
                if int(preview.get("estimated_payout") or 0) <= 0:
                    log(f"skip claim {key}/{name}: nothing owed")
                    continue
                self.write(f"claim:{key}:{name}", "claim_market_winnings", [market_id], account=account)
                claimed = account
            if claimed is not None:
                self.write(f"guard:double_claim:{key}", "claim_market_winnings", [market_id],
                           account=claimed, expect_error=True)

    def release_hedges(self, markets: dict) -> None:
        for hedge_id in ("1", "2"):
            try:
                row = self.read_json("get_hedge", [hedge_id])
            except Exception:  # noqa: BLE001 - hedge may not exist
                continue
            self.wait_until(row["unlock_epoch"], f"hedge {hedge_id} unlock epoch")
            self.write(f"hedge:release:{hedge_id}", "release_conditional_hedge", [hedge_id],
                       account=self.burners["alice" if hedge_id == "1" else "bob"])

    def ecosystem(self, markets: dict) -> None:
        account = self.burners["carol"]
        market_id = markets[MARKETS[0]["key"]]
        self.write("ecosystem:register", "register_ecosystem_consumer", ["prophetsyndicate"], account=account)
        self.write("ecosystem:ack", "acknowledge_ecosystem_feed", [market_id], account=account)
        self.write("guard:unregistered_ack", "acknowledge_ecosystem_feed", [market_id],
                   account=self.burners["bob"], expect_error=True)
        self.write("transfer:alice_to_bob", "transfer_tokens", [self.burners["bob"].address, 5 * UNIT],
                   account=self.burners["alice"])

    # ------------------------------------------------------------ lifecycle

    def run(self) -> None:
        self.ensure_deployed()
        self.fund_burners()
        self.deposit_desks()
        self.prove_soft_fail_refund()
        markets = self.prepare_markets()
        self.resolve_all(markets)
        self.challenge_and_audit(markets)
        self.open_hedge(markets)
        self.settle_all(markets)
        self.refund_timeouts(markets)
        self.release_hedges(markets)
        self.ecosystem(markets)
        self.build_evidence()

    # ------------------------------------------------------------ evidence

    def identity(self) -> dict:
        local_bytes = normalize_lf(CONTRACT.read_bytes())
        local_sha = sha256_hex(local_bytes)
        git_sha, git_size = git_blob_sha(ROOT)
        onchain = decode_contract_code(with_retries(
            lambda: self.client.provider.make_request("gen_getContractCode", [self.address]).get("result"),
            "getContractCode",
        ))
        remote_sha = None
        remote_size = 0
        try:
            response = requests.get(
                "https://raw.githubusercontent.com/hoveiser/prophet-grid/"
            f"{subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=str(ROOT), capture_output=True, text=True).stdout.strip() or 'main'}"
            "/contracts/prophet_grid.py",
                timeout=60,
            )
            if response.status_code == 200:
                remote_sha = sha256_hex(normalize_lf(response.content))
                remote_size = len(normalize_lf(response.content))
        except requests.RequestException:
            pass
        return {
            "local_lf_sha256": local_sha,
            "local_lf_bytes": len(local_bytes),
            "git_blob_sha256": git_sha,
            "git_blob_bytes": git_size,
            "onchain_sha256": sha256_hex(onchain),
            "onchain_bytes": len(onchain),
            "remote_github_sha256": remote_sha,
            "remote_github_bytes": remote_size,
            "match_local_git": git_sha == local_sha,
            "match_local_onchain": sha256_hex(onchain) == local_sha,
            "match_local_remote": remote_sha == local_sha,
            "match_all_four": (
                git_sha == local_sha and sha256_hex(onchain) == local_sha and remote_sha == local_sha
            ),
            "generated_at": now_iso(),
        }

    def build_evidence(self) -> None:
        markets = self.checkpoint["markets"]
        payload = {
            "project": "ProphetGrid Flagship v1",
            "milestone": TAG,
            "generated_at": now_iso(),
            "contract_address": self.address,
            "network": "studionet",
            "chain_id": CHAIN_ID,
            "rpc": RPC_URL,
            "constructor_args": [CLOSE_WINDOW, CHALLENGE_WINDOW, CHALLENGE_BOND],
            "deploy_tx": self.step("deploy").get("tx_hash"),
            "git_commit": subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
            ).stdout.strip(),
            "sha256_identity": self.identity(),
            "platform_stats": self.read_json("get_platform_stats"),
            "vault_invariants": self.read_json("check_vault_invariants"),
            "custody_accounting": self.read_json("get_custody_accounting_summary"),
            "access_model": self.read_json("get_access_model"),
            "consensus_policy": self.read_json("get_consensus_policy"),
            "native_custody_proof": {
                "contract_native_balance_wei": str(self.w3.eth.get_balance(self.address)),
                "contract_reported_wei": str(self.read_json("get_platform_stats")["native_custody_wei"]),
                "total_supply_units": str(self.read_json("get_platform_stats")["total_supply"]),
            },
            "market_notes": {market["key"]: market.get("note", "") for market in MARKETS},
            "markets": [],
            "resolution_receipts": [],
            "hedges": [],
            "consumers": [],
            "signers": {"main": self.main.address, **{k: v.address for k, v in self.burners.items()}},
            "consensus_proofs": [],
            "guard_reverts": [],
            "soft_fail_proof": [],
            "transactions": self.checkpoint["transactions"],
            "rejected_attempts": self.checkpoint["attempts"],
            "local_checks": run_local_checks(),
        }
        for key, market_id in markets.items():
            row = self.read_json("get_market", [market_id])
            row["book"] = key
            payload["markets"].append(row)
            receipt = self.read_json("get_resolution_receipt", [market_id])
            receipt["book"] = key
            payload["resolution_receipts"].append(receipt)
        for market in MARKETS:
            if market["key"] in markets:
                payload["market_notes"].setdefault(market["key"], market.get("note", ""))
        payload["market_notes"]["challenge_book"] = (
            "Book created by scripts/drive_challenge_lifecycle.py: resolved, bonded challenge "
            "filed, second challenge attempt soft failed, re-audited by consensus, finalized and claimed."
        )
        for hedge_id in ("1", "2"):
            try:
                payload["hedges"].append(self.read_json("get_hedge", [hedge_id]))
            except Exception:  # noqa: BLE001 - hedge may be absent
                pass
        for name, account in self.burners.items():
            payload["consumers"].append({"desk": name, "address": account.address,
                                         "portfolio": self.read_json("get_trader_portfolio", [account.address])})
        steps = self.checkpoint["steps"]
        for entry in self.checkpoint["transactions"]:
            step = entry.get("step", "")
            record = steps.get(step, {})
            if step.startswith(("resolve:", "audit:")) and entry.get("tx_hash"):
                payload["consensus_proofs"].append(entry)
            if step.startswith("guard:") and record.get("expected_revert"):
                payload["guard_reverts"].append({**entry, "error": record.get("error"),
                                                 "matched_expected_revert": record.get("matched_expected_revert")})
            if (step.startswith("soft_fail:") or step.startswith("refund:")
                    or step.startswith("challenge_payable:")):
                merged = dict(entry)
                for extra in ("refundable_after_soft_fail", "error"):
                    if record.get(extra) is not None:
                        merged[extra] = record[extra]
                payload["soft_fail_proof"].append(merged)
        save_json(EVIDENCE_FILE, payload)
        log(f"evidence written to {EVIDENCE_FILE}")
        identity = payload["sha256_identity"]
        log("four way sha256 match_all_four=" + str(identity["match_all_four"])
            + " local=" + identity["local_lf_sha256"][:16]
            + " onchain=" + identity["onchain_sha256"][:16]
            + " remote=" + str(identity["remote_github_sha256"])[:16])
        log("invariants ok=" + str(payload["vault_invariants"].get("ok")))
        log("markets=" + str(len(payload["markets"])) + " consensus_proofs=" + str(len(payload["consensus_proofs"]))
            + " guards=" + str(len(payload["guard_reverts"])))

    def print_status(self) -> None:
        log(f"address {self.address}")
        log(json.dumps(self.read_json("get_platform_stats"), indent=2)[:2000])
        for key, market_id in self.checkpoint["markets"].items():
            row = self.read_json("get_market", [market_id])
            log(f"{key} #{market_id} {row['status']} {row['phase']} band={row['band']} pot={row['pot']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy and exercise ProphetGrid Flagship v1")
    parser.add_argument("--deploy-only", action="store_true")
    parser.add_argument("--evidence-only", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "")
    if not key:
        print("GENLAYER_PRIVATE_KEY is missing from .env")
        return 2
    if not key.startswith("0x"):
        key = "0x" + key

    runner = Runner(key)
    if args.status:
        runner.print_status()
        return 0
    if args.evidence_only:
        runner.address = runner.checkpoint.get("contract_address")
        runner.build_evidence()
        return 0
    if args.deploy_only:
        runner.ensure_deployed()
        return 0
    runner.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
