"""Shared fixtures and helpers for ProphetGrid Flagship v1 direct mode tests.

The unlink shim below is a Windows hardening measure required by the genlayer
test harness: cached SDK directories are read only and Python raises
PermissionError when it clears them during cleanup.

Time model: the contract reads the transaction datetime from the GenVM message.
The harness refreshes sender, origin and value in the cached message dict when
the test mutates the VM, but not the datetime, so `set_time` below writes the
same dict entry. That is what makes every window enforceable in tests without
any clock advancing method on the contract.
"""

import json
import os
import sys
import time as _time

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


# Stake scale: 1 UNIT is 10**15 wei, the contract minimum deposit.
UNIT = 10 ** 15
CLOSE_WINDOW = 120
CHAL_WINDOW = 60
BOND = 10 * UNIT
BASE_EPOCH = 1_800_000_000

QUESTION = (
    "Does the ECB deposit facility rate fall by at least 50 basis points before the "
    "end of the fourth quarter?"
)
CRITERIA = (
    "Express the observed cumulative easing as basis points of a 200 basis point "
    "reference corridor. Resolve YES when the print reaches the strike, NO below it, "
    "and refund when the two sources contradict each other."
)
CATEGORY = "MACRO"
PRIMARY = "https://api.example.com/ecb/deposit-rate"
SECONDARY = "https://news.example.com/ecb/q4-decision"
COUNTER = "https://research.example.com/ecb-replay"

PRIMARY_TEXT = (
    "Official rate dashboard. The deposit facility rate fell 150 basis points across "
    "the corridor, which is 75 percent of the reference scale for the quarter."
)
SECONDARY_TEXT = (
    "Wire report confirming the same 150 basis point easing over the quarter with an "
    "identical reference corridor and no contradictory prints."
)
COUNTER_TEXT = (
    "Audit replay. The cumulative easing printed only 25 basis points on the same "
    "corridor, which contradicts the dashboard above."
)

PROMPT_PATTERN = r"(?s).*Extract macro data for a derivatives strike settlement.*"


_EPOCHS: dict = {}


def iso(epoch: int) -> str:
    return _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime(epoch))


def set_time(vm, epoch: int) -> int:
    """Move the deterministic transaction datetime to an absolute epoch."""
    epoch = int(epoch)
    text = iso(epoch)
    vm.warp(text)
    module = sys.modules.get("genlayer.gl")
    raw = getattr(module, "message_raw", None) if module is not None else None
    if isinstance(raw, dict):
        raw["datetime"] = text
    _EPOCHS[id(vm)] = epoch
    return epoch


def advance(vm, seconds: int) -> int:
    return set_time(vm, current(vm) + seconds)


def current(vm) -> int:
    return _EPOCHS.get(id(vm), BASE_EPOCH)


def print_payload(primary=7500, secondary=7500, corroborated=True, summary="Both prints agree."):
    return {
        "primary_observed_bps": primary,
        "secondary_observed_bps": secondary,
        "corroborated": corroborated,
        "summary": summary,
    }


def mock_evidence(vm, payload, primary_text=PRIMARY_TEXT, secondary_text=SECONDARY_TEXT,
                  counter_text=COUNTER_TEXT):
    """Install fresh web and model mocks for one adjudication."""
    vm.clear_mocks()
    vm.mock_web(r".*api\.example\.com.*", {"status": 200, "body": primary_text})
    vm.mock_web(r".*news\.example\.com.*", {"status": 200, "body": secondary_text})
    vm.mock_web(r".*research\.example\.com.*", {"status": 200, "body": counter_text})
    vm.mock_web(r".*\.example\.com.*", {"status": 200, "body": counter_text})
    body = payload if isinstance(payload, str) else json.dumps(payload)
    vm.mock_llm(PROMPT_PATTERN, body)


@pytest.fixture
def vm_time(direct_vm):
    set_time(direct_vm, BASE_EPOCH)
    return direct_vm


@pytest.fixture
def grid(vm_time, direct_deploy):
    contract = direct_deploy("contracts/prophet_grid.py", CLOSE_WINDOW, CHAL_WINDOW, BOND)
    set_time(vm_time, BASE_EPOCH)
    return contract


@pytest.fixture
def funded(vm_time, grid, direct_alice, direct_bob, direct_charlie):
    """Fund three desks with backed collateral through the payable entry point."""
    for account in (direct_alice, direct_bob, direct_charlie):
        vm_time.sender = account
        vm_time.value = 1000 * UNIT
        grid.fund_pgt_vault_payable()
    vm_time.value = 0
    vm_time.sender = direct_alice
    assert invariant(grid)["ok"] is True
    return grid


@pytest.fixture
def desk(funded):
    return funded


def deposit(vm, contract, account, units):
    vm.sender = account
    vm.value = units * UNIT
    out = json.loads(contract.fund_pgt_vault_payable())
    vm.value = 0
    return out


def create(vm, contract, account, question=QUESTION, strike=5000, corridor=1000,
           close=CLOSE_WINDOW, chal=CHAL_WINDOW, margin=600):
    vm.sender = account
    raw = contract.create_market(
        question, CATEGORY, PRIMARY, SECONDARY, CRITERIA, strike, corridor, close, chal, margin
    )
    return json.loads(raw)["market_id"]


def buy(vm, contract, account, market_id, side, units):
    vm.sender = account
    return contract.buy_outcome_shares(market_id, side, units * UNIT)


def stake(vm, contract, account, market_id, side, units):
    vm.sender = account
    vm.value = units * UNIT
    out = json.loads(contract.acquire_outcome_shares_payable(market_id, side))
    vm.value = 0
    return out


def resolve(vm, contract, account, market_id, payload=None, evidence=PRIMARY):
    mock_evidence(vm, payload or print_payload())
    vm.sender = account
    raw = contract.resolve_market_via_consensus(market_id, evidence)
    vm.clear_mocks()
    return json.loads(raw)


def challenge(vm, contract, account, market_id, counter=COUNTER):
    vm.sender = account
    return json.loads(contract.file_resolution_challenge(market_id, counter))


def challenge_payable(vm, contract, account, market_id, units, counter=COUNTER):
    vm.sender = account
    vm.value = units * UNIT
    out = json.loads(contract.challenge_market_resolution_payable(market_id, counter))
    vm.value = 0
    return out


def audit(vm, contract, account, market_id, payload):
    mock_evidence(vm, payload)
    vm.sender = account
    out = json.loads(contract.audit_resolution_challenge(market_id))
    vm.clear_mocks()
    return out


def finalize(vm, contract, account, market_id):
    vm.sender = account
    return json.loads(contract.finalize_market_settlement(market_id))


def claim(vm, contract, account, market_id):
    vm.sender = account
    return json.loads(contract.claim_market_winnings(market_id))


def refund(vm, contract, account, market_id):
    vm.sender = account
    return json.loads(contract.claim_refund(market_id))


def state(contract, market_id):
    return json.loads(contract.get_market(market_id))


def stats(contract):
    return json.loads(contract.get_platform_stats())


def invariant(contract) -> dict:
    return contract.check_vault_invariants()


def custody(contract) -> dict:
    return contract.get_custody_accounting_summary()


def balance(contract, account) -> int:
    return int(contract.token_balance_of(account.as_hex))


def refundable(contract, account) -> int:
    return int(contract.get_refundable_balance(account.as_hex))


def portfolio(contract, account):
    return json.loads(contract.get_trader_portfolio(account.as_hex))


def settle(vm, contract, market_id, operator):
    """Wait out the challenge window and finalize an already resolved market."""
    deadline = state(contract, market_id)["challenge_deadline_epoch"]
    set_time(vm, deadline)
    return finalize(vm, contract, operator, market_id)
