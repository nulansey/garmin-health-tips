"""One-time interactive Garmin Connect login.

Run locally:  .venv/bin/python -m src.setup_auth

Saves reusable auth tokens to ~/.garminconnect (or $GARMINTOKENS) and prints a
base64 blob to paste into the GitHub Actions secret GARMIN_TOKEN_B64.
Tokens last roughly a year; re-run this when they expire.
"""
import base64
import io
import os
import tarfile
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin


def main():
    tokenstore = os.environ.get("GARMINTOKENS", "~/.garminconnect")
    email = input("Garmin Connect email: ").strip()
    password = getpass("Garmin Connect password (not stored anywhere): ")
    api = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input(
            "Garmin just sent a code to your account email (or authenticator "
            "app).\nCheck it NOW and type the code here (do not press Enter "
            "without a code): "
        ).strip(),
    )
    # The mobile endpoints 429 aggressively and every hit counts as another
    # failed login, extending Garmin's account throttle — go straight to the
    # widget flow, which matches the normal browser login.
    api.client.skip_strategies = {"mobile+cffi", "mobile+requests"}
    api.login(tokenstore)
    print(f"\nLogin OK. Tokens saved to {tokenstore}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(Path(tokenstore).expanduser(), arcname=".garminconnect")
    blob = base64.b64encode(buf.getvalue()).decode()
    print("\nPaste this whole line as the GitHub secret GARMIN_TOKEN_B64:\n")
    print(blob)


if __name__ == "__main__":
    main()
