"""Shared fixtures for ProphetGrid direct mode tests.

The unlink shim below is a Windows hardening measure required by the
genlayer test harness: cached SDK directories are read only and Python
raises PermissionError when it tries to clear them during cleanup.

v2 time model: contracts derive current_epoch from the objective
transaction datetime. Tests control it exclusively through the direct_vm
warp cheatcode, exactly like a miner would move real block time forward.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

if sys.platform.startswith("win"):
    _original_unlink = os.unlink
    _original_remove = os.remove

    def _safe_remove(path, *args, **kwargs):
        try:
            _original_unlink(path, *args, **kwargs)
        except PermissionError:
            try:
                os.chmod(path, 0o700)
                _original_unlink(path, *args, **kwargs)
            except OSError:
                return None
        return None

    os.unlink = _safe_remove
    os.remove = _safe_remove

    _original_rmdir = os.rmdir

    def _safe_rmdir(path, *args, **kwargs):
        try:
            _original_rmdir(path, *args, **kwargs)
        except PermissionError:
            try:
                os.chmod(path, 0o700)
                _original_rmdir(path, *args, **kwargs)
            except OSError:
                return None
        return None

    os.rmdir = _safe_rmdir


WINDOW = 2
BOND = 50
GRACE = 3
MARKET_DURATION = 4

BASE_UTC = datetime(2026, 1, 1, tzinfo=timezone.utc)
EPOCH_BASE = int(BASE_UTC.timestamp()) // 60


def epoch_iso(epoch: int) -> str:
    """ISO timestamp 30 seconds into the given epoch."""
    seconds = (epoch - EPOCH_BASE) * 60 + 30
    return (BASE_UTC + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def warp_epoch(vm, epoch: int) -> None:
    """Move the transaction datetime into the requested epoch."""
    vm.warp(epoch_iso(epoch))


QUESTION = "Will the Ethereum blob base fee average below 0.01 gwei for the next 30 days?"
CRITERIA = (
    "Resolve YES when the published 30 day average blob base fee stays below 0.01 gwei, "
    "NO when it closes at or above 0.01 gwei, and refund when the source is silent."
)
PRIMARY = "https://api.example.com/eth/blob-fees"
EVIDENCE = "https://news.example.com/eth/blob-fee-report"
COUNTER = "https://research.example.com/blob-fee-audit"

PRIMARY_TEXT = (
    "Ethereum blob fee dashboard. The 30 day moving average blob base fee printed "
    "0.004 gwei on the snapshot block and the series stayed flat."
)
EVIDENCE_TEXT = (
    "Independent market report. Blob fees held near 0.004 gwei across the whole "
    "30 day window, which confirms the dashboard reading without gaps."
)
COUNTER_TEXT = (
    "Audit memo. A replay of the same 30 day window shows blob fees near 0.03 gwei "
    "after the repricing, which contradicts the dashboard snapshot."
)

PROMPT_PATTERN = r"(?s).*independent resolution auditor.*"


def verdict(stance="YES", confidence=90, authenticated=True, summary="Evidence supports the stance."):
    return {
        "stance": stance,
        "confidence": confidence,
        "source_authenticated": authenticated,
        "summary": summary,
    }


def apply_verdict(
    vm,
    payload,
    primary_text=PRIMARY_TEXT,
    evidence_text=EVIDENCE_TEXT,
    counter_text=COUNTER_TEXT,
    prompt_pattern=PROMPT_PATTERN,
):
    """Register fresh web and model mocks for a single adjudication."""
    vm.clear_mocks()
    vm.mock_web(r".*api\.example\.com.*", {"status": 200, "body": primary_text})
    vm.mock_web(r".*news\.example\.com.*", {"status": 200, "body": evidence_text})
    vm.mock_web(r".*research\.example\.com.*", {"status": 200, "body": counter_text})
    vm.mock_web(r".*\.example\.com.*", {"status": 200, "body": counter_text})
    if isinstance(payload, str):
        vm.mock_llm(prompt_pattern, payload)
    else:
        vm.mock_llm(prompt_pattern, json.dumps(payload))


@pytest.fixture
def grid(direct_vm, direct_deploy):
    warp_epoch(direct_vm, EPOCH_BASE)
    return direct_deploy("contracts/prophet_grid.py", WINDOW, BOND, GRACE)


@pytest.fixture
def funded(direct_vm, grid, direct_alice, direct_bob, direct_charlie):
    for account in (direct_alice, direct_bob, direct_charlie):
        direct_vm.sender = account
        grid.faucet_or_deposit(1000)
    direct_vm.sender = direct_alice
    return grid


def open_market(contract, question=QUESTION, duration=MARKET_DURATION):
    return contract.create_market(question, "CRYPTO", PRIMARY, CRITERIA, duration)


def trade(vm, contract, account, market_id, side, amount):
    vm.sender = account
    return contract.buy_outcome_shares(market_id, side, amount)


def resolve(vm, contract, account, market_id, payload, evidence=EVIDENCE):
    """Propose resolution at the exact objective close epoch."""
    state = json.loads(contract.get_market(market_id))
    warp_epoch(vm, state["close_epoch"])
    apply_verdict(vm, payload)
    vm.sender = account
    return contract.propose_resolution(market_id, evidence)


def challenge(vm, contract, account, market_id, payload, counter=COUNTER):
    """Bond backed challenge with its own live re-evaluation verdict."""
    apply_verdict(vm, payload)
    vm.sender = account
    return contract.challenge_resolution(market_id, counter)


def attempt_finalize(vm, contract, account, market_id):
    """Call finalize_market without touching the clock."""
    vm.sender = account
    return contract.finalize_market(market_id)


def finalize(vm, contract, account, market_id):
    """Wait the challenge window out with real time, then finalize."""
    state = json.loads(contract.get_market(market_id))
    warp_epoch(vm, state["challenge_deadline_epoch"] + 1)
    vm.sender = account
    return contract.finalize_market(market_id)


def claim(vm, contract, account, market_id):
    vm.sender = account
    return contract.claim_market_payout(market_id)


def claim_refund(vm, contract, account, market_id):
    vm.sender = account
    return contract.claim_refund(market_id)


def expire(vm, contract, account, market_id):
    """Wait for the resolution timeout, then expire the market."""
    state = json.loads(contract.get_market(market_id))
    warp_epoch(vm, state["resolution_timeout_epoch"])
    vm.sender = account
    return contract.expire_unresolved_market(market_id)


def market_state(contract, market_id):
    return json.loads(contract.get_market(market_id))


def stats(contract):
    return json.loads(contract.get_platform_stats())


def invariants(contract):
    return json.loads(contract.check_vault_invariants())


def balance(contract, account):
    return int(contract.token_balance_of(account.as_hex))


def settle_market(vm, contract, market_id, payload, operator, evidence=EVIDENCE):
    """Propose, wait the challenge window out with real time and finalize."""
    resolve(vm, contract, operator, market_id, payload, evidence)
    finalize(vm, contract, operator, market_id)
