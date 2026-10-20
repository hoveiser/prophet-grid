#!/usr/bin/env python3
"""Pre-submission checks with real commands and a PASS or FAIL table.

Every check runs against the working tree, the git history, the live GitHub
repository, the live Pages site and the deployed contract. Secrets are read from
.env only to search for them and are never printed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "prophet_grid.py"
DIST_INDEX = ROOT / "frontend" / "dist" / "index.html"
PAGES_URL = "https://hoveiser.github.io/prophet-grid/"
ADDRESS_PATTERN = re.compile(r"0x[0-9a-fA-F]{40}")
results: list[tuple[str, str, str]] = []


def record(name: str, command: str, ok: bool, detail: str = "") -> None:
    results.append((name, command, f"{'PASS' if ok else 'FAIL'}{(': ' + detail) if detail else ''}"))


def run(command: list[str], cwd: Path = ROOT, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_lint() -> None:
    result = run([str(ROOT / ".venv" / "bin" / "genvm-lint"), "check", str(CONTRACT)])
    ok = result.returncode == 0 and "Validation passed" in result.stdout
    record("Linter", "genvm-lint check contracts/prophet_grid.py", ok, result.stdout.strip().splitlines()[0] if result.stdout else result.stderr[:80])


def check_tests() -> None:
    result = run([str(ROOT / ".venv" / "bin" / "pytest"), "tests/test_prophet_grid_direct.py", "-q"], timeout=900)
    summary = (result.stdout or "").strip().splitlines()[-1] if result.stdout else ""
    ok = result.returncode == 0 and " passed" in summary
    record("Direct tests", "pytest tests/test_prophet_grid_direct.py -q", ok, summary)


def check_secrets() -> None:
    load_dotenv(ROOT / ".env")
    secrets = [value for value in (os.environ.get("GENLAYER_PRIVATE_KEY"), os.environ.get("GITHUB_TOKEN")) if value and len(value) > 16]
    objects = run(["git", "rev-list", "--objects", "--all"]).stdout.splitlines()
    blobs = {line.split()[0] for line in objects if len(line.split()) == 2}
    hits = 0
    for blob in blobs:
        content = subprocess.run(
            ["git", "cat-file", "-p", blob],
            cwd=str(ROOT),
            capture_output=True,
            timeout=60,
        ).stdout
        for secret in secrets:
            needle = secret[2:] if secret.startswith("0x") else secret
            if needle.encode() in content or secret.encode() in content:
                hits += 1
    tracked = run(["git", "ls-files"]).stdout.splitlines()
    env_tracked = ".env" in tracked
    ok = hits == 0 and not env_tracked
    record("Secrets", "scan every git blob for .env values", ok, f"{len(blobs)} blobs scanned, {hits} hits, .env tracked: {env_tracked}")


def check_dashes() -> None:
    offenders = []
    suffixes = {".py", ".ts", ".tsx", ".md", ".json", ".html", ".css", ".js", ".srt", ".yml", ".yaml", ".sh"}
    skip = {"node_modules", "dist", ".venv", "artifacts", ".git"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        if any(part in skip for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if "\u2014" in text or "\u2013" in text:
            offenders.append(str(path.relative_to(ROOT)))
    record("Dashes", "scan public files for em dash and en dash", not offenders, ", ".join(offenders[:5]) or "none")


def check_addresses() -> None:
    config = (ROOT / "frontend" / "src" / "config.ts").read_text(encoding="utf-8")
    addresses = set(ADDRESS_PATTERN.findall(config))
    evidence = json.loads((ROOT / "evidence" / "studionet_deployment.json").read_text(encoding="utf-8"))
    deployed = evidence.get("contract_address")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    ok = len(addresses) == 1 and deployed in addresses and deployed in readme
    record("Address", "config, README and evidence agree", ok, f"{sorted(addresses)} vs {deployed}")


def check_git_clean() -> None:
    status = run(["git", "status", "--porcelain"]).stdout.strip()
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    record("Git clean", "git status --porcelain", status == "", status.splitlines()[0] if status else f"clean at {head[:12]}")


def check_remote() -> None:
    local = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    remote = run(["git", "ls-remote", "origin", "refs/heads/main"]).stdout.split()
    remote_head = remote[0] if remote else ""
    record("Remote main", "git ls-remote origin refs/heads/main", remote_head == local, f"local {local[:12]} remote {remote_head[:12]}")


def check_onchain() -> None:
    result = run([str(ROOT / ".venv" / "bin" / "python"), str(ROOT / "scripts" / "verify_identity.py")], timeout=300)
    identity = {}
    try:
        identity = json.loads((ROOT / "evidence" / "sha256_identity.json").read_text(encoding="utf-8"))
    except Exception:
        identity = {}
    ok = result.returncode == 0 and identity.get("match_all_four") is True
    record("Four way sha256", "scripts/verify_identity.py", ok, f"match_all_four={identity.get('match_all_four')}")


def check_pages() -> None:
    if not DIST_INDEX.exists():
        record("GitHub Pages", "fetch live index.html", False, "frontend/dist/index.html missing")
        return
    expected = re.search(r"assets/index-[^\"]+\.js", DIST_INDEX.read_text(encoding="utf-8"))
    expected_asset = expected.group(0) if expected else "unknown"
    deadline = time.time() + 420
    last = "no response"
    while time.time() < deadline:
        try:
            response = requests.get(f"{PAGES_URL}?check={int(time.time())}", timeout=30)
            found = re.search(r"assets/index-[^\"]+\.js", response.text)
            last = f"HTTP {response.status_code}, asset {found.group(0) if found else 'none'}"
            if response.status_code == 200 and found and found.group(0) == expected_asset:
                record("GitHub Pages", "GET the live site and compare the asset", True, f"HTTP 200, {expected_asset}")
                return
        except requests.RequestException as exc:
            last = type(exc).__name__
        time.sleep(15)
    record("GitHub Pages", "GET the live site and compare the asset", False, f"{last}, expected {expected_asset}")


def check_video() -> None:
    video = ROOT / "docs" / "demo-video-subtitled.mp4"
    if not video.exists():
        record("Demo video", "ffprobe docs/demo-video-subtitled.mp4", False, "file missing")
        return
    probe = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-show_entries", "stream=codec_type", "-of", "json", str(video),
    ])
    try:
        payload = json.loads(probe.stdout)
        duration = float(payload.get("format", {}).get("duration", 0))
        has_audio = any(item.get("codec_type") == "audio" for item in payload.get("streams", []))
    except Exception:
        duration, has_audio = 0.0, False
    size_mb = video.stat().st_size / 1024 / 1024
    ok = 46.0 <= duration <= 50.0 and size_mb < 15 and has_audio
    record("Demo video", "ffprobe duration, audio stream, size", ok, f"{duration:.2f}s, {size_mb:.2f} MB, audio={has_audio}")


def check_video_policy() -> None:
    """The final demo video must be tracked on main and served on Pages.

    Raw recordings and the soundtrack stay ignored. Only the subtitled mp4 is
    committed, in docs/ for the repository and in frontend/public/ so the build
    publishes it next to the app.
    """
    tracked = set(run(["git", "ls-files"]).stdout.splitlines())
    expected = {"docs/demo-video-subtitled.mp4", "frontend/public/demo-video-subtitled.mp4"}
    missing = sorted(expected - tracked)
    leftovers = sorted(path for path in ("docs/demo-raw.webm", "artifacts/soundtrack.wav") if path in tracked)
    pending = sorted(
        run(["git", "ls-files", "--others", "--exclude-standard", "docs", "frontend/public"]).stdout.splitlines()
    )
    same_bytes = (ROOT / "docs" / "demo-video-subtitled.mp4").read_bytes() == (
        ROOT / "frontend" / "public" / "demo-video-subtitled.mp4"
    ).read_bytes()
    ok = not missing and not leftovers and not pending and same_bytes
    detail = f"tracked={len(expected) - len(missing)}/2 bytes_match={same_bytes} media_left_out={len(leftovers) + len(pending)}"
    if missing:
        detail += f" missing={missing}"
    if leftovers:
        detail += f" unexpectedly tracked={leftovers}"
    if pending:
        detail += f" untracked files remain={pending}"
    record("Video policy", "git ls-files and git ls-files --others --exclude-standard", ok, detail)


def check_video_urls() -> None:
    """Both published copies of the video must answer with HTTP 200."""
    urls = [
        "https://github.com/hoveiser/prophet-grid/raw/main/docs/demo-video-subtitled.mp4",
        f"{PAGES_URL}demo-video-subtitled.mp4",
    ]
    statuses = []
    for url in urls:
        try:
            response = requests.get(url, timeout=45, allow_redirects=True)
            statuses.append(response.status_code)
        except requests.RequestException:
            statuses.append(0)
    ok = all(status == 200 for status in statuses)
    record("Video URLs", "GET the repo raw file and the Pages copy", ok, f"statuses={statuses}")


def check_chain_views() -> None:
    script = r"""
import json, os, sys
from dotenv import load_dotenv
from genlayer_py import create_account, create_client, studionet
load_dotenv('.env')
key = os.environ['GENLAYER_PRIVATE_KEY']
if not key.startswith('0x'):
    key = '0x' + key
data = json.load(open('evidence/studionet_deployment.json'))
address = data['contract_address']
client = create_client(chain=studionet, account=create_account(key))
access = json.loads(client.read_contract(address=address, function_name='get_access_model', args=[]))
inv = json.loads(client.read_contract(address=address, function_name='check_vault_invariants', args=[]))
stats = json.loads(client.read_contract(address=address, function_name='get_platform_stats', args=[]))
print(json.dumps({'owner': access['owner'], 'roles': access['privileged_roles'], 'invariant': inv['ok'], 'markets': stats['total_markets'], 'clock': stats['clock_step']}))
"""
    result = run([str(ROOT / ".venv" / "bin" / "python"), "-c", script], timeout=180)
    ok = False
    detail = (result.stderr or "")[:120]
    if result.returncode == 0:
        try:
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            ok = payload["owner"] is None and payload["roles"] == 0 and payload["invariant"] is True
            detail = json.dumps(payload)
        except Exception:
            ok = False
    record("On chain views", "get_access_model and check_vault_invariants", ok, detail)


def main() -> int:
    check_lint()
    check_tests()
    check_secrets()
    check_dashes()
    check_addresses()
    check_git_clean()
    check_remote()
    check_onchain()
    check_chain_views()
    check_pages()
    check_video()
    check_video_policy()
    check_video_urls()

    width = max(len(name) for name, _, _ in results)
    print(f"{'CHECK'.ljust(width)} | RESULT")
    print("-" * (width + 3) + "+" + "-" * 40)
    failures = 0
    for name, command, result in results:
        print(f"{name.ljust(width)} | {result}")
        if result.startswith("FAIL"):
            failures += 1
    print()
    print(f"{len(results) - failures}/{len(results)} checks passed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
