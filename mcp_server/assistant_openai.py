"""RentCheck Copilot from the command line: the same agent the web app uses (backend/agent.py),
getting every figure from the RentCheck MCP server.

    pip install -r requirements.txt
    export OPENAI_API_KEY=...            # or put it in .env; never commit this
    python mcp_server/assistant_openai.py "Is €950 for a 2-bed apartment in Rathmines a scam risk?"
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import agent as copilot  # noqa: E402


async def main(question: str):
    ok, why = copilot.available()
    if not ok:
        sys.exit(f"RentCheck Copilot is unavailable: {why}")
    async with copilot.mcp_server() as rentcheck:
        result = await copilot.Runner.run(copilot.build_agent(rentcheck), copilot.build_input(question, None, None))
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or "What's a normal rent for a 2-bed apartment near Rathmines?"))
