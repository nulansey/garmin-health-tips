"""Commit local edits and sync them with GitHub so the cloud cron sees them."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _git(args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def pull(cwd=ROOT):
    r = _git(["pull", "--rebase"], cwd)
    if r.returncode != 0:
        _git(["rebase", "--abort"], cwd)
        return False, f"pull failed: {r.stderr.strip()[:200]}"
    return True, "pulled"


def commit_and_push(paths, message, cwd=ROOT):
    _git(["add", *paths], cwd)
    if _git(["diff", "--cached", "--quiet"], cwd).returncode == 0:
        return True, "no changes"
    r = _git(["commit", "-m", message], cwd)
    if r.returncode != 0:
        return False, f"commit failed: {r.stderr.strip()[:200]}"

    for attempt in (1, 2):
        r = _git(["pull", "--rebase"], cwd)
        if r.returncode != 0:
            _git(["rebase", "--abort"], cwd)
            return False, ("saved and committed locally, but couldn't reconcile "
                           "with GitHub — run `git status` in the repo")
        r = _git(["push"], cwd)
        if r.returncode == 0:
            return True, "pushed"
    return False, ("saved and committed locally, but push kept failing — "
                   f"{r.stderr.strip()[:200]}")
