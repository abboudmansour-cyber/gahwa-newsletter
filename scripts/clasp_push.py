#!/usr/bin/env python3
"""
clasp_push.py — Push local Apps Script files to Google Apps Script via clasp.

This script runs on the Hetzner VPS (the deployment authority).
It wraps `clasp push` with error handling and logging.

Prerequisites:
  - clasp installed globally (npm install -g @google/clasp)
  - Authenticated via `clasp login --no-localhost` (creates ~/.clasprc.json)
  - .clasp.json in repo root with the correct scriptId
"""

import subprocess
import sys
import os


def main():
    repo_root = "/opt/gahwa"
    os.chdir(repo_root)

    print("Running clasp push...")
    result = subprocess.run(
        ["clasp", "push", "--force"],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        print("✓ clasp push succeeded")
        print(result.stdout)
        return 0
    else:
        print("✗ clasp push failed")
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
