#!/usr/bin/env python3
"""Publish ProphetGrid to GitHub and GitHub Pages.

The token is read from .env and injected into a git credential helper through
the environment only. It is never written to disk and never printed.

Steps: create the public repo if needed, commit, tag studionet-v2-remediated,
push main, push frontend/dist to gh-pages, enable Pages and verify the live URL.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
OWNER = "hoveiser"
REPO = "prophet-grid"
API = "https://api.github.com"
PAGES_URL = f"https://{OWNER}.github.io/{REPO}/"
HELPER = ROOT / "tools" / "git-credential-helper.sh"
DIST = ROOT / "frontend" / "dist"
PAGES_WORKTREE = ROOT / "artifacts" / "gh-pages"
REPORT = ROOT / "evidence" / "publish_report.json"
COMMIT_NAME = "hoveiser"
COMMIT_EMAIL = "hoveiser@users.noreply.github.com"
TAG = "studionet-v2-remediated"
COMMIT_MESSAGE = (
    "Remediate steward rejection: objective epoch deadlines, enforced challenge "
    "window, zero-winner and timeout refund paths, studionet v2 evidence"
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


class GitHub:
    def __init__(self, token: str):
        self.token = token
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "prophetgrid-publisher",
            }
        )

    def call(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        response = self.session.request(method, f"{API}{path}", json=payload, timeout=60)
        try:
            body = response.json() if response.content else {}
        except ValueError:
            body = {}
        if isinstance(body, list):
            body = {"items": body}
        return response.status_code, body

    def login(self) -> str:
        status, body = self.call("GET", "/user")
        if status != 200:
            raise RuntimeError(f"GitHub auth failed with status {status}")
        return body.get("login", "unknown")


def run(command: list[str], token: str, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["GITHUB_TOKEN"] = token
    result = subprocess.run(
        command,
        cwd=str(ROOT),
        env=env,
        capture_output=capture,
        text=True,
    )
    if check and result.returncode != 0:
        stderr = (result.stderr or "").replace(token, "***")
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command[:3])}: {stderr[:400]}")
    return result


def git(*args: str, token: str, check: bool = True) -> subprocess.CompletedProcess:
    base = [
        "git",
        "-c",
        f"user.name={COMMIT_NAME}",
        "-c",
        f"user.email={COMMIT_EMAIL}",
    ] + helper_args()
    return run(base + list(args), token, check=check)


def helper_args() -> list[str]:
    """Force authentication through the token in the environment only.

    Both helper lists are reset first, so an ambient per host helper on the
    machine cannot answer for a push that is supposed to use GITHUB_TOKEN.
    """
    return [
        "-c",
        "credential.helper=",
        "-c",
        "credential.https://github.com.helper=",
        "-c",
        f"credential.https://github.com.helper=!{HELPER}",
    ]


def ensure_repo(api: GitHub) -> dict:
    status, body = api.call("GET", f"/repos/{OWNER}/{REPO}")
    if status == 200:
        log(f"repository exists: {body.get('html_url')}")
        return body
    if status != 404:
        raise RuntimeError(f"unexpected repo lookup status {status}")
    payload = {
        "name": REPO,
        "description": "AI adjudicated conditional macro and tech prediction markets on GenLayer",
        "private": False,
        "has_issues": True,
        "has_wiki": False,
        "has_projects": False,
    }
    status, body = api.call("POST", "/user/repos", payload)
    if status not in (200, 201):
        raise RuntimeError(f"repo creation failed with status {status}: {body.get('message')}")
    log(f"repository created: {body.get('html_url')}")
    return body


def commit_and_push(token: str) -> tuple[str, str]:
    run(["git", "check-ignore", "-q", ".env"], token, check=True)
    git("add", "-A", token=token)

    tracked = run(["git", "ls-files"], token).stdout.splitlines()
    if ".env" in tracked:
        raise RuntimeError("refusing to publish: .env is tracked")
    for forbidden in (".venv/", "node_modules/", "artifacts/"):
        if any(path.startswith(forbidden) for path in tracked):
            raise RuntimeError(f"refusing to publish: {forbidden} is tracked")

    status = run(["git", "status", "--porcelain"], token).stdout.strip()
    if status:
        git("commit", "-m", COMMIT_MESSAGE, token=token)
    head = run(["git", "rev-parse", "HEAD"], token).stdout.strip()
    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], token).stdout.strip()
    log(f"branch {branch} at {head[:12]}")

    remotes = run(["git", "remote"], token).stdout.split()
    if "origin" not in remotes:
        git("remote", "add", "origin", f"https://github.com/{OWNER}/{REPO}.git", token=token)

    push = git("push", "-u", "origin", branch, token=token, check=False)
    if push.returncode != 0:
        stderr = (push.stderr or "").replace(token, "***")
        raise RuntimeError(f"main push failed: {stderr[:600]}")
    log("main pushed")

    tags = run(["git", "tag", "--list", TAG], token).stdout.strip()
    if not tags:
        git("tag", "-a", TAG, "-m", "ProphetGrid studionet v2 steward remediation deployment", token=token)
    push_tag = git("push", "origin", TAG, token=token, check=False)
    if push_tag.returncode != 0:
        stderr = (push_tag.stderr or "").replace(token, "***")
        raise RuntimeError(f"tag push failed: {stderr[:600]}")
    log(f"tag {TAG} pushed")
    return head, branch


def publish_pages(token: str) -> str:
    if not DIST.exists():
        raise RuntimeError("frontend/dist is missing, run npm run build first")
    if PAGES_WORKTREE.exists():
        shutil.rmtree(PAGES_WORKTREE)
    PAGES_WORKTREE.mkdir(parents=True)
    for item in DIST.iterdir():
        if item.is_dir():
            shutil.copytree(item, PAGES_WORKTREE / item.name)
        else:
            shutil.copy2(item, PAGES_WORKTREE / item.name)
    (PAGES_WORKTREE / ".nojekyll").write_text("", encoding="utf-8")

    env = os.environ.copy()
    env["GITHUB_TOKEN"] = token
    commands = [
        ["git", "init", "-q", "-b", "gh-pages"],
        ["git", "-c", f"user.name={COMMIT_NAME}", "-c", f"user.email={COMMIT_EMAIL}", "add", "-A"],
        [
            "git",
            "-c",
            f"user.name={COMMIT_NAME}",
            "-c",
            f"user.email={COMMIT_EMAIL}",
            "commit",
            "-q",
            "-m",
            "Deploy ProphetGrid frontend to GitHub Pages",
        ],
        ["git", "remote", "add", "origin", f"https://github.com/{OWNER}/{REPO}.git"],
        ["git", *helper_args(), "push", "--force", "origin", "gh-pages"],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=str(PAGES_WORKTREE), env=env, capture_output=True, text=True)
        if result.returncode != 0:
            stderr = (result.stderr or "").replace(token, "***")
            raise RuntimeError(f"gh-pages step failed ({command[1] if len(command) > 1 else command[0]}): {stderr[:500]}")
    log("gh-pages pushed")
    return "gh-pages"


def enable_pages(api: GitHub) -> dict:
    payload = {"source": {"branch": "gh-pages", "path": "/"}}
    status, body = api.call("GET", f"/repos/{OWNER}/{REPO}/pages")
    if status == 404:
        status, body = api.call("POST", f"/repos/{OWNER}/{REPO}/pages", payload)
        if status in (200, 201):
            log("GitHub Pages enabled")
            return body
        if status != 409:
            raise RuntimeError(f"pages creation failed with status {status}: {body.get('message')}")
        log("GitHub Pages was already enabled, reading its configuration")
        status, body = api.call("GET", f"/repos/{OWNER}/{REPO}/pages")
        if status != 200:
            raise RuntimeError(f"pages lookup failed with status {status}")
    elif status != 200:
        raise RuntimeError(f"pages lookup failed with status {status}")

    source = body.get("source") or {}
    if source.get("branch") == "gh-pages":
        log("GitHub Pages already points at gh-pages")
        return body

    status, updated = api.call("PUT", f"/repos/{OWNER}/{REPO}/pages", payload)
    if status not in (200, 204):
        raise RuntimeError(f"pages update failed with status {status}: {updated.get('message')}")
    log("GitHub Pages source set to gh-pages")
    return updated or body


def verify_site(timeout: int = 600) -> dict:
    deadline = time.time() + timeout
    attempt = 0
    last_status = None
    while time.time() < deadline:
        attempt += 1
        try:
            response = requests.get(f"{PAGES_URL}?build={attempt}", timeout=30)
            last_status = response.status_code
            if response.status_code == 200 and "ProphetGrid" in response.text:
                asset = None
                for part in response.text.split('"'):
                    if part.startswith("/prophet-grid/assets/") and part.endswith(".js"):
                        asset = part
                        break
                asset_status = None
                if asset:
                    asset_response = requests.get(f"https://{OWNER}.github.io{asset}", timeout=30)
                    asset_status = asset_response.status_code
                log(f"site is live (HTTP {response.status_code}), asset {asset_status}")
                return {"status": response.status_code, "asset_status": asset_status, "asset": asset, "attempts": attempt}
        except requests.RequestException:
            last_status = "error"
        time.sleep(15)
    raise RuntimeError(f"site did not become live, last status {last_status}")


def main() -> int:
    load_dotenv(ROOT / ".env")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN is missing from .env")
        return 2

    api = GitHub(token)
    login = api.login()
    log(f"authenticated as {login}")
    if login.lower() != OWNER:
        log(f"warning: token belongs to {login}, expected {OWNER}")

    repo = ensure_repo(api)
    head, branch = commit_and_push(token)
    pages_branch = publish_pages(token)
    pages = enable_pages(api)
    site = verify_site()

    report = {
        "generated_at": now_iso(),
        "repository": f"https://github.com/{OWNER}/{REPO}",
        "branch": branch,
        "commit": head,
        "tag": TAG,
        "pages_branch": pages_branch,
        "pages_status": pages.get("status"),
        "pages_url": PAGES_URL,
        "site": site,
        "default_branch": repo.get("default_branch"),
        "visibility": "public" if not repo.get("private", True) else "private",
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    log(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
