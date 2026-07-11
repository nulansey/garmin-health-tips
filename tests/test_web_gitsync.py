import subprocess

import pytest

from web import gitsync


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    origin = tmp_path / "origin.git"
    _git(tmp_path, "init", "--bare", str(origin))
    clone = tmp_path / "clone"
    _git(tmp_path, "clone", str(origin), str(clone))
    _git(clone, "config", "user.email", "test@test")
    _git(clone, "config", "user.name", "test")
    (clone / "config.yaml").write_text("goal: 1\n")
    _git(clone, "add", "config.yaml")
    _git(clone, "commit", "-m", "init")
    _git(clone, "push", "origin", "HEAD")
    return clone


def test_no_changes_is_ok(repo):
    ok, msg = gitsync.commit_and_push(["config.yaml"], "config: noop", cwd=repo)
    assert ok and msg == "no changes"


def test_commit_and_push(repo):
    (repo / "config.yaml").write_text("goal: 2\n")
    ok, msg = gitsync.commit_and_push(["config.yaml"], "config: update", cwd=repo)
    assert ok
    # verify the commit actually reached the origin (branch-name agnostic)
    log = subprocess.run(["git", "log", "--all", "--oneline"],
                         cwd=repo.parent / "origin.git",
                         capture_output=True, text=True).stdout
    assert "config: update" in log


def test_push_after_remote_advance(repo, tmp_path):
    # someone else (the cron) pushed history in the meantime
    other = tmp_path / "other"
    _git(tmp_path, "clone", str(repo.parent / "origin.git"), str(other))
    _git(other, "config", "user.email", "cron@test")
    _git(other, "config", "user.name", "cron")
    (other / "tips.json").write_text("[]\n")
    _git(other, "add", "tips.json")
    _git(other, "commit", "-m", "Record sent tip")
    _git(other, "push")

    (repo / "config.yaml").write_text("goal: 3\n")
    ok, msg = gitsync.commit_and_push(["config.yaml"], "config: update", cwd=repo)
    assert ok
    assert (repo / "tips.json").exists()  # rebase brought the remote commit in
