"""Configuration for the RentCheck backend. Secrets come from the environment (or a git-ignored .env file),
never from the code or the frontend."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
MCP_SERVER = ROOT / "mcp_server" / "server.py"


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Tiny .env reader (KEY=value per line) so there's no extra dependency. Real env vars win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
HOST = os.getenv("RENTCHECK_HOST", "127.0.0.1")
PORT = int(os.getenv("RENTCHECK_PORT", "8787"))
MAX_LISTING_CHARS = 6000
MAX_HISTORY_TURNS = 10
