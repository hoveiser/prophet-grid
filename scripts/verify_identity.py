#!/usr/bin/env python3
"""Verify the four way sha256 identity of the deployed contract.

Checks that the local LF file, the git blob, the on chain code and the GitHub
raw file are byte identical. Writes evidence/sha256_identity.json and updates
the identity block of evidence/studionet_deployment.json.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from genlayer_py import create_account, create_client, studionet

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_REL = "contracts/prophet_grid.py"
CONTRACT = ROOT / CONTRACT_REL
DEPLOY_EVIDENCE = ROOT / "evidence" / "studionet_deployment.json"
IDENTITY_FILE = ROOT / "evidence" / "sha256_identity.json"
REPO = "hoveiser/prophet-grid"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def git_blob() -> bytes:
    return subprocess.run(
        ["git", "-C", str(ROOT), "cat-file", "blob", f"HEAD:{CONTRACT_REL}"],
        capture_output=True,
        check=True,
    ).stdout


def git_object_id() -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-tree", "HEAD", CONTRACT_REL],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        parts = out.split()
        return parts[2] if len(parts) >= 3 else None
    except Exception:
        return None


def decode_code(value) -> bytes:
    if isinstance(value, bytes):
        raw = value
    elif isinstance(value, str):
        text = value.strip()
        raw = b""
        if text.startswith("0x"):
            try:
                raw = bytes.fromhex(text[2:])
            except ValueError:
                raw = b""
        if not raw:
            try:
                import base64

                candidate = base64.b64decode(text, validate=True)
            except Exception:
                candidate = b""
            raw = candidate if candidate.startswith(b"# {") else text.encode("utf-8")
    else:
        raw = b""
    return normalize_lf(raw)


def fetch_remote() -> bytes | None:
    headers = {"Accept": "application/vnd.github.raw", "User-Agent": "prophetgrid-verifier"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://api.github.com/repos/{REPO}/contents/{CONTRACT_REL}?ref=main"
    try:
        response = requests.get(url, headers=headers, timeout=45)
        if response.status_code == 200:
            return normalize_lf(response.content)
        print(f"remote content api status {response.status_code}")
    except Exception as exc:  # noqa: BLE001
        print(f"remote fetch failed: {type(exc).__name__}")
    try:
        response = requests.get(
            f"https://raw.githubusercontent.com/{REPO}/main/{CONTRACT_REL}",
            timeout=45,
        )
        if response.status_code == 200:
            return normalize_lf(response.content)
        print(f"remote raw status {response.status_code}")
    except Exception as exc:  # noqa: BLE001
        print(f"remote raw failed: {type(exc).__name__}")
    return None


def main() -> int:
    load_dotenv(ROOT / ".env")
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "")
    if not key:
        print("GENLAYER_PRIVATE_KEY is missing from .env")
        return 2
    if not key.startswith("0x"):
        key = "0x" + key

    if not DEPLOY_EVIDENCE.exists():
        print("evidence/studionet_deployment.json is missing")
        return 2
    deployment = json.loads(DEPLOY_EVIDENCE.read_text(encoding="utf-8"))
    address = deployment.get("contract_address")
    if not address:
        print("deployment evidence has no contract_address")
        return 2

    local = normalize_lf(CONTRACT.read_bytes())
    git_bytes = normalize_lf(git_blob())
    remote = fetch_remote()

    client = create_client(chain=studionet, account=create_account(key))
    response = client.provider.make_request("gen_getContractCode", [address])
    onchain = decode_code(response.get("result"))

    identity = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "contract_address": address,
        "network": "studionet",
        "chain_id": 61999,
        "local_lf_sha256": sha256_hex(local),
        "local_lf_bytes": len(local),
        "git_blob_sha256": sha256_hex(git_bytes),
        "git_blob_bytes": len(git_bytes),
        "git_blob_object": git_object_id(),
        "onchain_sha256": sha256_hex(onchain),
        "onchain_bytes": len(onchain),
        "remote_github_sha256": sha256_hex(remote) if remote is not None else None,
        "remote_github_bytes": len(remote) if remote is not None else None,
        "match_local_git": sha256_hex(local) == sha256_hex(git_bytes),
        "match_local_onchain": sha256_hex(local) == sha256_hex(onchain),
        "match_local_remote": remote is not None and sha256_hex(local) == sha256_hex(remote),
        "match_all_four": (
            remote is not None
            and sha256_hex(local) == sha256_hex(git_bytes) == sha256_hex(onchain) == sha256_hex(remote)
        ),
    }

    IDENTITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    IDENTITY_FILE.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")

    deployment["sha256_identity"] = identity
    DEPLOY_EVIDENCE.write_text(json.dumps(deployment, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(identity, indent=2))
    if not (identity["match_local_git"] and identity["match_local_onchain"]):
        print("FAIL: local, git and on chain code differ")
        return 1
    if not identity["match_local_remote"]:
        print("PENDING: remote GitHub content is not identical yet")
        return 1
    print("OK: four way sha256 identity verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
