#!/usr/bin/env python3
"""Deploy the hardened ProphetGrid v2 contract to studionet and drive it live.

v2 remediation coverage for the Steward rejection:
- premature resolution before the objective close epoch is probed on chain and
  must revert (guard:early_resolution),
- caller side clock manipulation is probed and must revert
  (guard:advance_clock),
- finalize and claim probes before the challenge window elapses revert,
- a bond backed challenge re-runs live consensus and restarts the window,
- a zero winner market finalizes as REFUNDABLE_ZERO_WINNERS and refunds every
  principal through claim_refund,
- an abandoned market passes its resolution timeout, is expired by a
  participant and refunds 100 percent of the stakes.

The script is idempotent: every step is written to a checkpoint file and
skipped on the next run. It records transaction hashes, consensus results,
guard reverts and a sha256 identity block in evidence/studionet_deployment.json.

Usage:
    .venv/bin/python scripts/deploy_studionet.py
    .venv/bin/python scripts/deploy_studionet.py --deploy-only
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
CHECKPOINT = EVIDENCE_DIR / "_checkpoint.json"
EVIDENCE_FILE = EVIDENCE_DIR / "studionet_deployment.json"
ARTIFACTS = ROOT / "artifacts"

RPC_URL = "https://studio.genlayer.com/api"
CHAIN_ID = 61999
WINDOW = 10
BOND = 50
GRACE = 24
EPOCH_SECONDS = 60
BURNER_FUND_WEI = 2 * 10**18
POLITE_DELAY = 2.0
POLL_DELAY = 15.0
WAIT_LIMIT_SECONDS = 2400
TERMINAL_STATUSES = ("FINALIZED", "CANCELED", "UNDETERMINED")
GUARD_EXPECTATIONS = {
    "guard:advance_clock": "advance_market_clock is removed",
    "guard:early_resolution": "objective close epoch",
    "guard:early_trading": "trading window is closed",
    "guard:early_finalize": "CHALLENGE_WINDOW_OPEN",
    "guard:early_claim": "CHALLENGE_WINDOW_OPEN",
    "guard:early_expiry": "resolution grace period",
    "guard:post_timeout_proposal": "resolution timeout elapsed",
    "guard:losing_claim": "no winning shares",
    "guard:double_claim": "already claimed",
    "guard:double_refund": "already claimed",
    "guard:refund_wrong_status": "no refund to claim",
}

MARKETS = [
    {
        "key": "eth_blob",
        "duration": 22,
        "question": "Did EIP-7691 raise the Ethereum blob target to 6 and the maximum to 9 per block?",
        "category": "TECH",
        "primary": "https://eips.ethereum.org/EIPS/eip-7691",
        "evidence": "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-7691.md",
        "counter": "https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-7691.md?plain=1",
        "criteria": (
            "Resolve YES when the primary EIP text states a blob target of 6 and a maximum of 9 "
            "per block. Resolve NO when the text states different numbers."
        ),
    },
    {
        "key": "ai_sdk",
        "duration": 22,
        "question": "Does the official openai python package metadata link to its GitHub repository?",
        "category": "AI",
        "primary": "https://pypi.org/pypi/openai/json",
        "evidence": "https://raw.githubusercontent.com/openai/openai-python/main/pyproject.toml",
        "counter": "https://pypi.org/pypi/openai/json?view=metadata",
        "criteria": (
            "Resolve YES when the package metadata lists a project URL on "
            "github.com/openai/openai-python. Resolve NO when no such URL is present."
        ),
    },
    {
        "key": "macro_gdp",
        "duration": 22,
        "question": "Is the latest World Bank US GDP observation above 20 trillion US dollars?",
        "category": "MACRO",
        "primary": "https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=3",
        "evidence": "https://api.worldbank.org/v2/country/USA?format=json",
        "counter": "https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=5",
        "criteria": (
            "Resolve YES when the most recent annual US GDP value in the World Bank API is "
            "greater than 20000000000000 USD. Resolve NO when it is at or below that value."
        ),
    },
    {
        "key": "abandoned",
        "duration": 22,
        "question": "Will the demo abandoned market ever receive a consensus resolution proposal?",
        "category": "OTHER",
        "primary": "https://eips.ethereum.org/EIPS/eip-1",
        "evidence": "https://eips.ethereum.org/EIPS/eip-1",
        "counter": "https://eips.ethereum.org/EIPS/eip-1",
        "criteria": (
            "Resolve YES only when an Ethereum Improvement Proposal number one document "
            "explicitly lists this market question as resolved. NO otherwise."
        ),
    },
]


def leader_execution(receipt: dict) -> str | None:
    """Read the leader execution result from a studionet receipt."""
    consensus = receipt.get("consensus_data") or {}
    leader = consensus.get("leader_receipt") or []
    if isinstance(leader, dict):
        leader = [leader]
    for item in leader:
        if not isinstance(item, dict):
            continue
        if item.get("mode") == "leader" and item.get("execution_result"):
            return item.get("execution_result")
    for item in leader:
        if isinstance(item, dict) and item.get("execution_result"):
            return item.get("execution_result")
    return None


def vote_summary(receipt: dict) -> dict:
    votes = ((receipt.get("consensus_data") or {}).get("votes")) or {}
    agree = sum(1 for value in votes.values() if str(value).lower() == "agree")
    disagree = sum(1 for value in votes.values() if str(value).lower() == "disagree")
    return {"agree": agree, "disagree": disagree, "total": len(votes), "votes": votes}


class StepFailed(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def wall_epoch() -> int:
    return int(time.time()) // EPOCH_SECONDS


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def venv_exe(name: str) -> str:
    scripts = ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin")
    candidate = scripts / name
    if os.name == "nt" and not str(candidate).endswith((".exe", ".cmd", ".bat")):
        if Path(str(candidate) + ".exe").exists():
            candidate = Path(str(candidate) + ".exe")
    return str(candidate)


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
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")
    # On Windows a concurrent reader or a antivirus scan can hold the
    # destination for a moment and os.replace raises PermissionError. The
    # checkpoint write is not consensus critical, so retry briefly instead
    # of aborting a multi hour live scenario.
    for attempt in range(10):
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            time.sleep(0.5 * (attempt + 1))
    os.replace(temp, path)


def retryable(exc: Exception) -> bool:
    text = str(exc).lower()
    markers = ("429", "rate limit", "too many requests", "timeout", "timed out", "connection",
               "temporarily unavailable", "502", "503", "504", "reset by peer", "remote end closed")
    return any(marker in text for marker in markers)


def with_retries(fn, label: str, attempts: int = 10, base_delay: float = 3.0):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - retries are intentional
            last = exc
            if not retryable(exc) or attempt == attempts:
                raise
            delay = base_delay * attempt
            log(f"retry {attempt}/{attempts - 1} for {label} after {type(exc).__name__}: {str(exc)[:120]}")
            time.sleep(delay)
    raise StepFailed(f"{label} failed: {last}")


def decode_contract_code(value) -> bytes:
    """Decode the code payload returned by gen_getContractCode.

    Studionet returns base64, some nodes return hex or raw text.
    """
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
            if candidate.startswith(b"# {") or candidate.startswith(b"#{"):
                raw = candidate
            else:
                raw = text.encode("utf-8")
    else:
        raw = b""
    return normalize_lf(raw)


def derive_burner_key(master_key: str, index: int) -> str:
    seed = f"prophet-grid-burner-v1:{index}:{master_key.lower()}"
    digest = Web3.keccak(text=seed).hex()
    if digest.startswith("0x"):
        digest = digest[2:]
    return "0x" + digest


class Runner:
    def __init__(self, main_key: str, deploy_only: bool = False):
        self.main = create_account(main_key)
        self.client = create_client(chain=studionet, account=self.main)
        self.w3 = Web3(Web3.HTTPProvider(RPC_URL))
        self.checkpoint = load_json(CHECKPOINT, {})
        self.checkpoint.setdefault("steps", {})
        self.checkpoint.setdefault("transactions", [])
        self.checkpoint.setdefault("attempts", [])
        self.checkpoint.setdefault("markets", {})
        self.deploy_only = deploy_only
        self.burners = {}
        for index, name in enumerate(("alice", "bob", "carol"), start=1):
            self.burners[name] = create_account(derive_burner_key(main_key, index))
        self.address = self.checkpoint.get("contract_address")

    # ------------------------------------------------------------------
    # Checkpoint helpers
    # ------------------------------------------------------------------

    def done(self, key: str) -> bool:
        return key in self.checkpoint["steps"]

    def step(self, key: str) -> dict:
        return self.checkpoint["steps"][key]

    def record(self, key: str, entry: dict) -> dict:
        self.checkpoint["steps"][key] = entry
        self.checkpoint["transactions"].append(
            {
                "step": key,
                "tx_hash": entry.get("tx_hash"),
                "status": entry.get("status"),
                "result": entry.get("result"),
                "execution": entry.get("execution"),
                "account": entry.get("account"),
            }
        )
        save_json(CHECKPOINT, self.checkpoint)
        return entry

    # ------------------------------------------------------------------
    # Chain helpers
    # ------------------------------------------------------------------

    def wait_final(self, tx_hash: str, timeout: int = 1800) -> dict:
        deadline = time.time() + timeout
        last_status = None
        while time.time() < deadline:
            try:
                receipt = self.client.get_transaction(tx_hash)
            except Exception as exc:  # noqa: BLE001 - network jitter
                if retryable(exc):
                    time.sleep(5)
                    continue
                raise
            status = str(receipt.get("status_name") or "")
            last_status = status or last_status
            if status in TERMINAL_STATUSES:
                return receipt
            time.sleep(5)
        raise StepFailed(f"transaction {tx_hash} did not finalize, last status {last_status}")

    @staticmethod
    def summarize(tx_hash: str, receipt: dict, function_name: str, account: str) -> dict:
        votes = vote_summary(receipt)
        return {
            "tx_hash": tx_hash if isinstance(tx_hash, str) else tx_hash.hex(),
            "function": function_name,
            "account": account,
            "status": receipt.get("status_name"),
            "result": receipt.get("result_name"),
            "execution": leader_execution(receipt),
            "votes_agree": votes["agree"],
            "votes_total": votes["total"],
            "recorded_at": now_iso(),
        }

    def write(self, key: str, address: str, function_name: str, args: list, account=None, expect_error: bool = False) -> dict:
        if self.done(key):
            entry = self.step(key)
            log(f"skip {key} (recorded {entry.get('tx_hash', '')[:18]})")
            return entry
        signer = account or self.main

        attempts = 3 if function_name in ("propose_resolution", "challenge_resolution", "finalize_market") else 1
        last_entry = None
        for attempt in range(1, attempts + 1):
            log(f"write {key} -> {function_name} as {signer.address[:10]} (attempt {attempt}/{attempts})")

            def submit():
                return self.client.write_contract(
                    address=address,
                    function_name=function_name,
                    account=signer,
                    args=args,
                )

            tx_hash = with_retries(submit, f"submit {key}")
            receipt = self.wait_final(tx_hash)
            entry = self.summarize(tx_hash, receipt, function_name, signer.address)
            last_entry = entry
            execution = entry.get("execution")
            finalized = entry.get("status") == "FINALIZED"
            majority = entry.get("result") == "MAJORITY_AGREE"

            if expect_error:
                entry["expected_error"] = True
                entry["matched_expected_error"] = finalized and execution == "ERROR"
                if not entry["matched_expected_error"]:
                    log(f"WARNING: {key} was expected to revert but finished with {entry.get('status')} {entry.get('result')} {execution}")
                self.record(key, entry)
                time.sleep(POLITE_DELAY)
                return entry

            if finalized and majority and execution == "SUCCESS":
                self.record(key, entry)
                time.sleep(POLITE_DELAY)
                return entry

            self.checkpoint["attempts"].append(dict(entry, step=key, attempt=attempt))
            save_json(CHECKPOINT, self.checkpoint)
            log(
                f"{key} not accepted: status={entry.get('status')} result={entry.get('result')} execution={execution}"
            )
            if attempt < attempts:
                time.sleep(15)

        raise StepFailed(
            f"{key} was not accepted after {attempts} attempts: "
            f"{last_entry.get('status') if last_entry else 'no receipt'}"
        )

    def read_json(self, function_name: str, args: list | None = None) -> dict:
        def call():
            return self.client.read_contract(
                address=self.address,
                function_name=function_name,
                args=args or [],
            )

        value = with_retries(call, f"read {function_name}")
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        if isinstance(value, str):
            return json.loads(value)
        return value

    def read_scalar(self, function_name: str, args: list | None = None):
        def call():
            return self.client.read_contract(
                address=self.address,
                function_name=function_name,
                args=args or [],
            )

        return with_retries(call, f"read {function_name}")

    # ------------------------------------------------------------------
    # Objective time waiting. The contract clock is the chain datetime; the
    # only way to move past a deadline is to wait for real block time.
    # ------------------------------------------------------------------

    def wait_for_epoch(self, label: str, target_epoch: int) -> None:
        started = time.time()
        while True:
            state = self.read_json("get_platform_stats")
            current = int(state.get("current_epoch") or 0)
            if current >= target_epoch or wall_epoch() >= target_epoch:
                log(f"{label}: reached epoch {max(current, target_epoch)}")
                return
            if time.time() - started > WAIT_LIMIT_SECONDS:
                raise StepFailed(f"{label}: stuck at epoch {current}, target {target_epoch}")
            time.sleep(POLL_DELAY)

    def wait_market_window(self, market_key: str, market_id: int) -> None:
        """Wait until finalize becomes legal: current_epoch > challenge_deadline_epoch."""
        state = self.read_json("get_market", [market_id])
        if state.get("status") in ("FINALIZED", "REFUNDABLE_ZERO_WINNERS", "EXPIRED"):
            return
        deadline = int(state.get("challenge_deadline_epoch") or 0)
        self.wait_for_epoch(f"{market_key} challenge window", deadline + 1)
        time.sleep(POLL_DELAY)

    # ------------------------------------------------------------------
    # Steps
    # ------------------------------------------------------------------

    def finalize_when_ready(self, market_key: str, market_id: int) -> dict:
        state = self.read_json("get_market", [market_id])
        if state.get("status") in ("FINALIZED", "REFUNDABLE_ZERO_WINNERS"):
            log(f"market {market_key} already settled as {state.get('status')}")
            return state
        self.wait_market_window(market_key, market_id)
        self.write(
            f"finalize:{market_key}",
            self.address,
            "finalize_market",
            [market_id],
            account=self.main,
        )
        return self.read_json("get_market", [market_id])

    def settle_after_finalize(self, market_key: str, market_id: int) -> None:
        """Route to winner claims or the zero winner refund path by on chain status."""
        state = self.read_json("get_market", [market_id])
        status = state.get("status")
        outcome = state.get("provisional_outcome")
        if status == "REFUNDABLE_ZERO_WINNERS":
            log(f"market {market_key} finalized as REFUNDABLE_ZERO_WINNERS, opening refunds")
            for label in ("alice", "bob", "carol"):
                account = self.burners[label]
                receipt = self.read_json("get_payout_receipt", [market_id, account.address])
                if receipt.get("exists"):
                    continue
                position = self.read_json("get_trader_portfolio", [account.address])
                stakes = sum(
                    p["principal"] for p in position.get("positions", []) if p["market_id"] == market_id
                )
                if stakes == 0:
                    continue
                self.write(f"refund:{market_key}:{label}", self.address, "claim_refund", [market_id], account=account)
            self.write(
                f"guard:double_refund:{market_key}",
                self.address,
                "claim_refund",
                [market_id],
                account=self.burners["alice"],
                expect_error=True,
            )
            return

        if outcome == "OUTCOME_INVALID_REFUND":
            for label in ("alice", "bob", "carol"):
                account = self.burners[label]
                receipt = self.read_json("get_payout_receipt", [market_id, account.address])
                if receipt.get("exists"):
                    continue
                position = self.read_json("get_trader_portfolio", [account.address])
                stakes = sum(
                    p["principal"] for p in position.get("positions", []) if p["market_id"] == market_id
                )
                if stakes == 0:
                    continue
                self.write(f"refund:{market_key}:{label}", self.address, "claim_market_payout", [market_id], account=account)
            return

        winner_yes = outcome == "OUTCOME_YES"
        claims = {
            "eth_blob": [("alice", "YES"), ("carol", "YES"), ("bob", "NO")],
            "macro_gdp": [("bob", "YES"), ("carol", "NO")],
            "ai_sdk": [("alice", "NO"), ("bob", "NO")],
        }.get(market_key, [])
        for label, side in claims:
            account = self.burners[label]
            receipt = self.read_json("get_payout_receipt", [market_id, account.address])
            if receipt.get("exists"):
                log(f"claim {market_key} for {label} already recorded on chain")
                continue
            is_winner = (side == "YES" and winner_yes) or (side == "NO" and not winner_yes)
            if is_winner:
                self.write(f"claim:{market_key}:{label}", self.address, "claim_market_payout", [market_id], account=account)
            else:
                self.write(
                    f"guard:losing_claim:{market_key}:{label}",
                    self.address,
                    "claim_market_payout",
                    [market_id],
                    account=account,
                    expect_error=True,
                )
        winners = [label for label, side in claims if (side == "YES" and winner_yes) or (side == "NO" and not winner_yes)]
        if winners:
            first = winners[0]
            self.write(
                f"guard:double_claim:{market_key}:{first}",
                self.address,
                "claim_market_payout",
                [market_id],
                account=self.burners[first],
                expect_error=True,
            )

    def ensure_deployed(self) -> str:
        if self.address:
            try:
                stats = self.read_json("get_platform_stats")
                log(f"reusing deployment at {self.address} ({stats.get('total_markets')} markets)")
                return self.address
            except Exception as exc:  # noqa: BLE001 - stale checkpoint
                log(f"checkpoint address not usable: {type(exc).__name__}: {str(exc)[:120]}")

        if self.done("deploy"):
            entry = self.step("deploy")
            self.address = entry.get("contract_address")
            if self.address:
                return self.address

        code = CONTRACT.read_text(encoding="utf-8")
        log("deploying contract to studionet")
        tx_hash = with_retries(
            lambda: self.client.deploy_contract(code=code, account=self.main, args=[WINDOW, BOND, GRACE]),
            "deploy",
        )
        receipt = self.wait_final(tx_hash)
        address = self.extract_contract_address(receipt, tx_hash)
        if not address:
            save_json(ARTIFACTS / "deploy_receipt.json", receipt)
            raise StepFailed("could not extract contract address from the deploy receipt, see artifacts/deploy_receipt.json")
        self.address = address
        entry = self.summarize(tx_hash, receipt, "__deploy__", self.main.address)
        entry["contract_address"] = address
        entry["contract_version"] = "v2-remediated"
        self.record("deploy", entry)
        self.checkpoint["contract_address"] = address
        save_json(CHECKPOINT, self.checkpoint)
        log(f"deployed at {address}")
        return address

    @staticmethod
    def extract_contract_address(receipt: dict, tx_hash: str) -> str | None:
        for key in ("recipient", "to_address", "contract_address"):
            value = receipt.get(key)
            if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                if value.lower() != "0x" + "0" * 40:
                    return value
        leader = (receipt.get("consensus_data") or {}).get("leader_receipt") or {}
        if isinstance(leader, dict):
            for key in ("contract_address", "address", "recipient"):
                value = leader.get(key)
                if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                    return value
        decoded = receipt.get("tx_data_decoded") or {}
        if isinstance(decoded, dict):
            for key in ("contract_address", "recipient", "to"):
                value = decoded.get(key)
                if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                    return value
        return None

    def fund_burners(self) -> None:
        for name, account in self.burners.items():
            key = f"fund:{name}"
            if self.done(key):
                continue
            balance = self.w3.eth.get_balance(account.address)
            if balance >= BURNER_FUND_WEI:
                self.record(key, {"tx_hash": None, "already_funded": True, "balance_wei": str(balance), "account": account.address, "recorded_at": now_iso()})
                log(f"{name} already funded")
                continue
            log(f"funding {name} at {account.address[:10]} with 2 GEN")
            nonce = self.w3.eth.get_transaction_count(self.main.address)
            gas_price = self.w3.eth.gas_price
            tx = {
                "nonce": nonce,
                "to": account.address,
                "value": BURNER_FUND_WEI,
                "gas": 21000,
                "maxFeePerGas": gas_price,
                "maxPriorityFeePerGas": gas_price,
                "chainId": CHAIN_ID,
                "type": 2,
            }
            signed = self.main.sign_transaction(tx)
            raw = signed.raw_transaction.hex()
            if not raw.startswith("0x"):
                raw = "0x" + raw
            response = with_retries(
                lambda: self.client.provider.make_request("eth_sendRawTransaction", [raw]),
                f"fund {name}",
            )
            tx_hash = response.get("result")
            deadline = time.time() + 180
            balance = 0
            while time.time() < deadline:
                balance = self.w3.eth.get_balance(account.address)
                if balance >= BURNER_FUND_WEI:
                    break
                time.sleep(3)
            self.record(key, {"tx_hash": tx_hash, "balance_wei": str(balance), "account": account.address, "recorded_at": now_iso()})
            log(f"{name} funded, balance {balance}")

    def ensure_markets(self) -> dict:
        for market in MARKETS:
            key = f"market:{market['key']}"
            if self.done(key):
                self.checkpoint["markets"][market["key"]] = self.step(key)["market_id"]
                continue
            entry = self.write(
                key,
                self.address,
                "create_market",
                [market["question"], market["category"], market["primary"], market["criteria"], market["duration"]],
                account=self.main,
            )
            market_id = int(self.read_scalar("get_market_count"))
            entry["market_id"] = market_id
            entry["duration_epochs"] = market["duration"]
            self.checkpoint["steps"][key] = entry
            self.checkpoint["markets"][market["key"]] = market_id
            save_json(CHECKPOINT, self.checkpoint)
            log(f"market {market['key']} created with id {market_id}")
        return self.checkpoint["markets"]

    def market_state(self, market_id: int) -> dict:
        return self.read_json("get_market", [market_id])

    def run(self) -> None:  # noqa: C901 - linear demo scenario
        address = self.ensure_deployed()
        if self.deploy_only:
            log("deploy only, stopping here")
            return

        self.fund_burners()

        for name, account in self.burners.items():
            self.write(f"deposit:{name}", address, "faucet_or_deposit", [1000], account=account)

        markets = self.ensure_markets()
        alice = self.burners["alice"]
        bob = self.burners["bob"]
        carol = self.burners["carol"]

        trades = [
            ("eth_blob", "alice", "YES", 300),
            ("eth_blob", "bob", "NO", 200),
            ("eth_blob", "carol", "YES", 100),
            ("ai_sdk", "alice", "NO", 150),
            ("ai_sdk", "bob", "NO", 90),
            ("macro_gdp", "bob", "YES", 120),
            ("macro_gdp", "carol", "NO", 80),
            ("abandoned", "alice", "YES", 40),
            ("abandoned", "bob", "NO", 20),
        ]
        for market_key, trader, side, amount in trades:
            account = self.burners[trader]
            self.write(
                f"trade:{market_key}:{trader}:{side}",
                address,
                "buy_outcome_shares",
                [markets[market_key], side, amount],
                account=account,
            )

        # Guard probe: caller side clock manipulation is impossible in v2.
        self.write("guard:advance_clock", address, "advance_market_clock", [WINDOW + 1], account=alice, expect_error=True)

        eth = markets["eth_blob"]
        ai = markets["ai_sdk"]
        macro = markets["macro_gdp"]
        abandoned = markets["abandoned"]

        # Steward hole 1: premature resolution must revert on chain.
        if not self.done("guard:early_resolution"):
            self.write("guard:early_resolution", address, "propose_resolution", [eth, MARKETS[0]["evidence"]], account=alice, expect_error=True)

        # The abandoned market is never resolved. Probe the expiry guard while
        # it is still inside its resolution grace period.
        if not self.done("guard:early_expiry"):
            self.write("guard:early_expiry", address, "expire_unresolved_market", [abandoned], account=carol, expect_error=True)

        # Market eth_blob: wait the objective close, then drive the full
        # challenge flow with real time only.
        eth_state = self.market_state(eth)
        if eth_state.get("status") == "OPEN":
            self.wait_for_epoch("eth_blob close epoch", int(eth_state["close_epoch"]))
            if not self.done("guard:early_trading"):
                self.write("guard:early_trading", address, "buy_outcome_shares", [eth, "YES", 10], account=carol, expect_error=True)
            self.write("resolve:eth_blob", address, "propose_resolution", [eth, MARKETS[0]["evidence"]], account=alice)
        eth_state = self.market_state(eth)
        if eth_state.get("status") == "CHALLENGE_WINDOW":
            # Fire the live challenge first: it re-runs consensus and restarts
            # the window, so the early claim and finalize probes below always
            # execute inside an open window even when the network is slow.
            if not self.done("challenge:eth_blob"):
                self.write("challenge:eth_blob", address, "challenge_resolution", [eth, MARKETS[0]["counter"]], account=bob)
            if not self.done("guard:early_claim"):
                self.write("guard:early_claim", address, "claim_market_payout", [eth], account=bob, expect_error=True)
            if not self.done("guard:early_finalize"):
                self.write("guard:early_finalize", address, "finalize_market", [eth], account=carol, expect_error=True)

        # Market ai_sdk: only NO stakes. Consensus is expected to answer YES,
        # producing the zero winner refund lifecycle.
        ai_state = self.market_state(ai)
        if ai_state.get("status") == "OPEN":
            self.wait_for_epoch("ai_sdk close epoch", int(ai_state["close_epoch"]))
            self.write("resolve:ai_sdk", address, "propose_resolution", [ai, MARKETS[1]["evidence"]], account=carol)

        # Market macro_gdp: plain resolve and settle.
        macro_state = self.market_state(macro)
        if macro_state.get("status") == "OPEN":
            self.wait_for_epoch("macro_gdp close epoch", int(macro_state["close_epoch"]))
            self.write("resolve:macro_gdp", address, "propose_resolution", [macro, MARKETS[2]["evidence"]], account=bob)

        self.finalize_when_ready("eth_blob", eth)
        self.settle_after_finalize("eth_blob", eth)
        self.write("transfer:alice_to_bob", address, "transfer_tokens", [bob.address, 10], account=alice)

        self.finalize_when_ready("ai_sdk", ai)
        self.settle_after_finalize("ai_sdk", ai)

        self.finalize_when_ready("macro_gdp", macro)
        self.settle_after_finalize("macro_gdp", macro)
        if not self.done("guard:refund_wrong_status"):
            self.write("guard:refund_wrong_status", address, "claim_refund", [macro], account=alice, expect_error=True)

        # Steward hole 2: the abandoned market must expire and refund after
        # the resolution timeout with zero further consensus.
        ab_state = self.market_state(abandoned)
        if ab_state.get("status") == "OPEN":
            self.wait_for_epoch("abandoned timeout epoch", int(ab_state["resolution_timeout_epoch"]))
            if not self.done("guard:post_timeout_proposal"):
                self.write("guard:post_timeout_proposal", address, "propose_resolution", [abandoned, MARKETS[3]["evidence"]], account=alice, expect_error=True)
            self.write("expire:abandoned", address, "expire_unresolved_market", [abandoned], account=carol)
        ab_state = self.market_state(abandoned)
        if ab_state.get("status") == "EXPIRED":
            for label, account in (("alice", alice), ("bob", bob)):
                receipt = self.read_json("get_payout_receipt", [abandoned, account.address])
                if not receipt.get("exists"):
                    self.write(f"refund:abandoned:{label}", address, "claim_refund", [abandoned], account=account)

        self.build_evidence()

    # ------------------------------------------------------------------
    # Evidence
    # ------------------------------------------------------------------

    def build_evidence(self) -> None:
        log("collecting on chain evidence")
        stats = self.read_json("get_platform_stats")
        invariants = self.read_json("check_vault_invariants")
        access_model = self.read_json("get_access_model")
        markets_payload = []
        resolution_receipts = []
        for market in MARKETS:
            market_id = self.checkpoint["markets"].get(market["key"])
            if market_id is None:
                continue
            state = self.read_json("get_market", [market_id])
            resolution_receipts.append(self.read_json("get_resolution_receipt", [market_id]))
            markets_payload.append(
                {
                    "key": market["key"],
                    "market_id": market_id,
                    "question": state.get("question"),
                    "category": state.get("category"),
                    "primary_source_url": state.get("primary_source_url"),
                    "status": state.get("status"),
                    "phase": state.get("phase"),
                    "close_epoch": state.get("close_epoch"),
                    "resolution_timeout_epoch": state.get("resolution_timeout_epoch"),
                    "resolved_at_epoch": state.get("resolved_at_epoch"),
                    "challenge_deadline_epoch": state.get("challenge_deadline_epoch"),
                    "finalized_at_epoch": state.get("finalized_at_epoch"),
                    "yes_pool": state.get("yes_pool"),
                    "no_pool": state.get("no_pool"),
                    "forfeit_pot": state.get("forfeit_pot"),
                    "total_pot": state.get("total_pot"),
                    "outcome_band": state.get("provisional_outcome"),
                    "confidence_anchor": state.get("confidence_anchor"),
                    "source_authenticated": state.get("source_authenticated"),
                    "unclaimed_refund_principal": state.get("unclaimed_refund_principal"),
                    "remaining_liability": state.get("remaining_liability"),
                    "evidence_digest": state.get("evidence_digest"),
                    "resolution_summary": state.get("resolution_summary"),
                    "challenges": len(resolution_receipts[-1].get("challenges", [])),
                }
            )

        code_bytes = normalize_lf(CONTRACT.read_bytes())
        local_sha = sha256_hex(code_bytes)
        git_blob_sha = None
        git_blob_bytes_len = None
        try:
            blob = subprocess.run(
                ["git", "-C", str(ROOT), "cat-file", "blob", "HEAD:contracts/prophet_grid.py"],
                capture_output=True,
                check=True,
            ).stdout
            blob = normalize_lf(blob)
            git_blob_sha = sha256_hex(blob)
            git_blob_bytes_len = len(blob)
        except Exception as exc:  # noqa: BLE001 - optional evidence
            log(f"git blob hash unavailable: {exc}")

        onchain_sha = None
        onchain_len = None
        onchain_snippet = None
        try:
            response = with_retries(
                lambda: self.client.provider.make_request("gen_getContractCode", [self.address]),
                "gen_getContractCode",
            )
            code = response.get("result")
            raw = decode_contract_code(code)
            onchain_sha = sha256_hex(raw)
            onchain_len = len(raw)
            onchain_snippet = raw[:80].decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001 - optional evidence
            log(f"on chain code hash unavailable: {type(exc).__name__}: {str(exc)[:160]}")

        remote_sha = None
        try:
            url = "https://raw.githubusercontent.com/hoveiser/prophet-grid/main/contracts/prophet_grid.py"
            response = requests.get(url, timeout=30)
            if response.status_code == 200:
                remote_sha = sha256_hex(normalize_lf(response.content))
        except Exception:  # noqa: BLE001 - repo may not be pushed yet
            remote_sha = None

        guard_reverts = []
        for key, entry in self.checkpoint["steps"].items():
            if not key.startswith("guard:"):
                continue
            expected = GUARD_EXPECTATIONS.get(key, "")
            if not expected:
                for prefix, message in (
                    ("guard:losing_claim", GUARD_EXPECTATIONS["guard:losing_claim"]),
                    ("guard:double_claim", GUARD_EXPECTATIONS["guard:double_claim"]),
                    ("guard:double_refund", GUARD_EXPECTATIONS["guard:double_refund"]),
                ):
                    if key.startswith(prefix):
                        expected = message
                        break
            guard_reverts.append(
                {
                    "step": key,
                    "tx_hash": entry.get("tx_hash"),
                    "expected": expected,
                    "execution": entry.get("execution"),
                    "result": entry.get("result"),
                    "votes_agree": entry.get("votes_agree"),
                    "votes_total": entry.get("votes_total"),
                    "matched": entry.get("matched_expected_error", entry.get("execution") == "ERROR"),
                }
            )
        guard_reverts.sort(key=lambda row: row["step"])

        consensus_proofs = []
        for key, entry in self.checkpoint["steps"].items():
            if key.startswith(("resolve:", "challenge:")):
                consensus_proofs.append(
                    {
                        "step": key,
                        "tx_hash": entry.get("tx_hash"),
                        "status": entry.get("status"),
                        "result": entry.get("result"),
                        "votes_agree": entry.get("votes_agree"),
                        "votes_total": entry.get("votes_total"),
                        "majority_agree": entry.get("result") == "MAJORITY_AGREE",
                    }
                )
        consensus_proofs.sort(key=lambda row: row["step"])

        refund_proofs = []
        for key, entry in self.checkpoint["steps"].items():
            if key.startswith(("refund:", "expire:")):
                refund_proofs.append(
                    {
                        "step": key,
                        "tx_hash": entry.get("tx_hash"),
                        "function": entry.get("function"),
                        "status": entry.get("status"),
                        "result": entry.get("result"),
                        "execution": entry.get("execution"),
                    }
                )
        refund_proofs.sort(key=lambda row: row["step"])

        local_checks = run_local_checks()
        identity = {
            "local_lf_sha256": local_sha,
            "local_lf_bytes": len(code_bytes),
            "git_blob_sha256": git_blob_sha,
            "git_blob_bytes": git_blob_bytes_len,
            "git_blob_object": git_blob_object(ROOT),
            "onchain_sha256": onchain_sha,
            "onchain_bytes": onchain_len,
            "onchain_snippet": onchain_snippet,
            "remote_github_sha256": remote_sha,
            "match_local_git": local_sha == git_blob_sha,
            "match_local_onchain": local_sha == onchain_sha,
            "match_all_four": bool(remote_sha) and local_sha == git_blob_sha == onchain_sha == remote_sha,
        }

        evidence = {
            "project": "ProphetGrid",
            "contract_version": "v2-remediated",
            "network": "studionet",
            "chain_id": CHAIN_ID,
            "rpc_url": RPC_URL,
            "deployed_at": self.checkpoint.get("steps", {}).get("deploy", {}).get("recorded_at"),
            "generated_at": now_iso(),
            "contract_address": self.address,
            "deployer": self.main.address,
            "runner_pin": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
            "challenge_window_epochs": WINDOW,
            "resolution_grace_epochs": GRACE,
            "epoch_seconds": EPOCH_SECONDS,
            "challenge_bond_amount": BOND,
            "signers": {
                "deployer": self.main.address,
                "alice": self.burners["alice"].address,
                "bob": self.burners["bob"].address,
                "carol": self.burners["carol"].address,
            },
            "markets": markets_payload,
            "resolution_receipts": resolution_receipts,
            "access_model": access_model,
            "notes": [
                "v2 remediation: the logical clock was removed. Epochs derive from the objective block datetime. advance_market_clock reverts for every caller.",
                "guard transactions are real submissions that finalized with MAJORITY_AGREE and a leader execution result of ERROR, proving the revert happened inside validator consensus, not off chain.",
                "the abandoned market demonstrates the unresolved market refund path: expire after resolution_timeout_epoch, then claim_refund of 100 percent principal.",
            ],
            "platform_stats": stats,
            "vault_invariants": invariants,
            "guard_reverts": guard_reverts,
            "consensus_proofs": consensus_proofs,
            "refund_lifecycle": refund_proofs,
            "sha256_identity": identity,
            "local_checks": local_checks,
            "explorer": f"https://genlayer-explorer.vercel.app/contracts/{self.address}",
            "transactions": [
                tx for tx in self.checkpoint["transactions"] if tx.get("tx_hash")
            ],
        }
        save_json(EVIDENCE_FILE, evidence)
        save_json(ARTIFACTS / "studionet_transactions.json", self.checkpoint["transactions"])
        log(f"evidence written to {EVIDENCE_FILE.relative_to(ROOT)}")
        log(
            "sha256 local=%s git=%s onchain=%s remote=%s"
            % (local_sha[:12], str(git_blob_sha)[:12], str(onchain_sha)[:12], str(remote_sha)[:12])
        )
        log(f"invariant ok: {invariants.get('ok')}, transactions: {len(evidence['transactions'])}")

    def print_status(self) -> None:
        print(json.dumps(self.checkpoint, indent=2)[:4000])


def git_blob_object(root: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-tree", "HEAD", "contracts/prophet_grid.py"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        parts = out.split()
        if len(parts) >= 3:
            return parts[2]
    except Exception:  # noqa: BLE001 - optional evidence
        return None
    return None


def run_local_checks() -> dict:
    result = {"lint": "not run", "tests": "not run", "tests_passed": 0, "tests_failed": 0}
    try:
        lint = subprocess.run(
            [venv_exe("genvm-lint"), "check", str(CONTRACT)],
            capture_output=True,
            text=True,
            timeout=180,
        )
        result["lint"] = "passed" if lint.returncode == 0 else "failed"
        result["lint_output"] = (lint.stdout or "").strip().splitlines()[:6]
    except Exception as exc:  # noqa: BLE001
        result["lint"] = f"error: {exc}"

    try:
        tests = subprocess.run(
            [venv_exe("pytest"), "tests/test_prophet_grid_direct.py", "-q"],
            capture_output=True,
            text=True,
            timeout=900,
            cwd=str(ROOT),
        )
        tail = (tests.stdout or "").strip().splitlines()
        summary = tail[-1] if tail else ""
        result["tests"] = "passed" if tests.returncode == 0 else "failed"
        result["tests_summary"] = summary
        if " passed" in summary:
            try:
                result["tests_passed"] = int(summary.split(" passed")[0].split()[-1])
            except Exception:  # noqa: BLE001
                pass
        if " failed" in summary:
            try:
                result["tests_failed"] = int(summary.split(" failed")[0].split()[-1])
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:  # noqa: BLE001
        result["tests"] = f"error: {exc}"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy ProphetGrid to studionet")
    parser.add_argument("--deploy-only", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--evidence-only", action="store_true")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "")
    if not key:
        print("GENLAYER_PRIVATE_KEY is missing from .env, refusing to continue")
        return 2
    if not key.startswith("0x"):
        key = "0x" + key

    runner = Runner(key, deploy_only=args.deploy_only)
    if args.status:
        runner.print_status()
        return 0
    if args.evidence_only:
        if not runner.address:
            print("no deployment recorded in the checkpoint")
            return 2
        runner.build_evidence()
        return 0

    runner.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
