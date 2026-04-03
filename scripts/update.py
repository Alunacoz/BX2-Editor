#!/usr/bin/env python3
"""
BX Editor Updater

1. Ensures git is installed (installs it if not)
2. Ensures this is a git repo pointed at the right remote (initialises if not)
3. Runs git pull --ff-only origin main (or resets to origin/main on first init)

User data (config.json, venv/) is never touched — git only modifies files it
tracks, and those are listed in .gitignore.
"""

import subprocess
import sys
from pathlib import Path


GITHUB_REPO = "Alunacoz/BX-Editor-FX"
REMOTE_URL  = f"https://github.com/{GITHUB_REPO}.git"
BRANCH      = "main"

GITIGNORE_LINES = [
    "venv/",
    "config.json",
    "__pycache__/",
    "*.pyc",
]


# ── Root detection ────────────────────────────────────────────────────────────

def _find_root() -> Path:
    """
    Walk up from this file's location until we find a directory containing
    index.html — that's the project root. Works whether update.py is run
    from scripts/, the root, or anywhere else.
    """
    candidate = Path(__file__).resolve().parent
    for _ in range(6):
        if (candidate / "index.html").exists():
            return candidate
        candidate = candidate.parent
    print("  !!  Could not locate the BX Editor project root.")
    print("      Make sure index.html exists in the project folder.")
    print("      Do not move update.py outside the project.")
    sys.exit(1)

ROOT = _find_root()


# ── Helpers ───────────────────────────────────────────────────────────────────

def ok(text):   print(f"  OK  {text}")
def info(text): print(f"      {text}")
def step(text): print(f"  >>  {text}")
def fail(text): print(f"  !!  {text}", file=sys.stderr)

def run(args, **kwargs):
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)

def run_out(args):
    r = subprocess.run(args, capture_output=True, text=True, cwd=ROOT)
    return r.stdout.strip(), r.returncode


# ── Git installation ──────────────────────────────────────────────────────────

def find_git():
    import shutil
    found = shutil.which("git")
    if found:
        return found
    for p in [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
    ]:
        if Path(p).exists():
            return p
    return None


def ensure_git():
    import shutil

    git = find_git()
    if git:
        ver, _ = run_out([git, "--version"])
        ok(f"git found: {ver}")
        return git

    fail("git is not installed.")
    print()

    plat = sys.platform
    if plat == "win32":
        info("git can be installed via winget:")
        info("  winget install Git.Git")
    elif plat == "darwin":
        if shutil.which("brew"):
            info("git can be installed via Homebrew:")
            info("  brew install git")
        else:
            info("git can be installed via Xcode Command Line Tools.")
            info("This will open an install dialog.")
    else:
        for mgr in ["apt-get", "dnf", "pacman", "zypper"]:
            if shutil.which(mgr):
                info(f"git can be installed via {mgr}:")
                info(f"  sudo {mgr} install git")
                break
        else:
            fail("No supported package manager found.")
            info("Install git manually from https://git-scm.com/ then re-run.")
            _pause()
            sys.exit(1)

    print()
    ans = input("  Install git now? (Y/N): ").strip().lower()
    if ans != "y":
        print()
        info("Install git from https://git-scm.com/ then run the updater again.")
        _pause()
        sys.exit(1)

    print()
    if plat == "win32":
        step("Running: winget install Git.Git")
        r = subprocess.run(
            ["winget", "install", "Git.Git",
             "--source", "winget",
             "--accept-package-agreements", "--accept-source-agreements"],
            cwd=ROOT,
        )
        if r.returncode != 0:
            fail("winget install failed.")
            _pause()
            sys.exit(1)
        ok("git installed.")
        info("Close this window and re-run the updater so git is on PATH.")
        _pause()
        sys.exit(0)

    elif plat == "darwin":
        if shutil.which("brew"):
            step("Running: brew install git")
            r = subprocess.run(["brew", "install", "git"], cwd=ROOT)
            if r.returncode != 0:
                fail("brew install failed.")
                _pause()
                sys.exit(1)
        else:
            step("Running: xcode-select --install")
            subprocess.run(["xcode-select", "--install"])
            info("Complete the Xcode CLT dialog, then re-run the updater.")
            _pause()
            sys.exit(0)

    else:
        for mgr, args in [
            ("apt-get", ["sudo", "apt-get", "install", "git"]),
            ("dnf",     ["sudo", "dnf",     "install", "git"]),
            ("pacman",  ["sudo", "pacman",  "-S",      "git"]),
            ("zypper",  ["sudo", "zypper",  "install", "git"]),
        ]:
            if shutil.which(mgr):
                step(f"Running: sudo {mgr} install git")
                r = subprocess.run(args, cwd=ROOT)
                if r.returncode != 0:
                    fail(f"{mgr} install failed.")
                    _pause()
                    sys.exit(1)
                ok("git installed.")
                break

    git = find_git()
    if not git:
        fail("git still not found after install. Please restart and try again.")
        _pause()
        sys.exit(1)
    return git


# ── .gitignore ────────────────────────────────────────────────────────────────

def ensure_gitignore():
    gi = ROOT / ".gitignore"
    existing = gi.read_text(encoding="utf-8") if gi.exists() else ""
    added = [l for l in GITIGNORE_LINES if l not in existing]
    if added:
        with gi.open("a", encoding="utf-8") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            f.write("\n".join(added) + "\n")
        ok(f".gitignore updated ({len(added)} entries added)")
    else:
        ok(".gitignore already up to date")


# ── Repo initialisation ───────────────────────────────────────────────────────

def is_git_repo(git):
    _, code = run_out([git, "rev-parse", "--is-inside-work-tree"])
    return code == 0


def ensure_repo(git):
    if is_git_repo(git):
        remote_url, code = run_out([git, "remote", "get-url", "origin"])
        if code != 0:
            step("Adding remote origin...")
            run([git, "remote", "add", "origin", REMOTE_URL])
            ok(f"Remote set to {REMOTE_URL}")
        elif remote_url != REMOTE_URL:
            step("Updating remote URL...")
            run([git, "remote", "set-url", "origin", REMOTE_URL])
            ok(f"Remote updated to {REMOTE_URL}")
        else:
            ok(f"Remote OK ({REMOTE_URL})")
        return False
    else:
        step("Initialising git repository...")
        ensure_gitignore()
        run([git, "init", "-b", BRANCH])
        run([git, "remote", "add", "origin", REMOTE_URL])
        ok(f"Repository initialised, remote -> {REMOTE_URL}")
        return True


# ── Update ────────────────────────────────────────────────────────────────────

def do_update(git, fresh_init):
    step(f"Fetching {REMOTE_URL} ...")
    run([git, "fetch", "origin", BRANCH], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok("Fetch complete")

    if fresh_init:
        step("Aligning working tree to remote...")
        run([git, "reset", "--hard", f"origin/{BRANCH}"])
        run([git, "branch", "--set-upstream-to", f"origin/{BRANCH}", BRANCH])
        ok("Working tree aligned to remote")
    else:
        step("Pulling latest changes...")
        r = subprocess.run(
            [git, "pull", "--ff-only", "origin", BRANCH],
            cwd=ROOT,
        )
        if r.returncode != 0:
            print()
            fail("Fast-forward pull failed.")
            info("Your local files have diverged from the remote.")
            info("To force-reset to the latest version (losing local changes):")
            info(f"  git fetch origin && git reset --hard origin/{BRANCH}")
            return False
        ok("Pull complete")
    return True


# ── Pause helper ──────────────────────────────────────────────────────────────

def _pause():
    if "--no-pause" not in sys.argv:
        input("\n      Press Enter to exit...")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print()
    print("  BX Editor - Updater")
    print("  " + "=" * 20)
    print()

    step("Checking for git...")
    git = ensure_git()

    step("Checking repository...")
    fresh = ensure_repo(git)

    if do_update(git, fresh):
        print()
        print("  Update complete!")
    else:
        print()
        fail("Update did not complete. See messages above.")

    _pause()
