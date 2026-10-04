"""Start RentCheck: the web app and the Copilot API on one port.

    python run.py            # http://127.0.0.1:8787
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    import uvicorn
    from backend import config
    from backend.app import app
    print(f"RentCheck running at http://{config.HOST}:{config.PORT}")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
