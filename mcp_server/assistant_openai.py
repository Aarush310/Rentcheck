"""LetCheck assistant on OpenAI, using the LetCheck MCP server for every figure.

    pip install openai-agents "mcp[cli]"
    export OPENAI_API_KEY=...            # never commit this
    python assistant_openai.py "Is €950 for a 2-bed apartment in Rathmines a scam risk?"
"""
import asyncio
import os
import sys
from pathlib import Path

from agents import Agent, Runner
from agents.mcp import MCPServerStdio

INSTRUCTIONS = """You are LetCheck, helping people in Ireland understand rents and avoid rental scams.
Use the letcheck tools for every rent figure and quote the quarter it is from. RTB figures are average rents
agreed in new tenancies, not asking prices. You have no live listings. For scam questions use check_listing and
repeat the Garda advice: view in person and check the keys before paying; pay traceably; report scams to the
local Garda station and your bank. Be brief and plain."""


async def main(question: str):
    server_py = Path(__file__).with_name("server.py")
    async with MCPServerStdio(name="letcheck", params={"command": sys.executable, "args": [str(server_py)]},
                              cache_tools_list=True) as letcheck:
        agent = Agent(name="LetCheck", instructions=INSTRUCTIONS, mcp_servers=[letcheck],
                      model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"))
        result = await Runner.run(agent, question)
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or "What's a normal rent for a 2-bed apartment near Rathmines?"))
