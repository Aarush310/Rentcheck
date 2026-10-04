"""RentCheck MCP server: Irish rental data and scam checks as tools for any MCP client
(the RentCheck Copilot, ChatGPT / OpenAI Agents, Claude Desktop, Codex, Cursor ...).

Data: RTB Average Monthly Rent Report (CSO table RIQ02, data.gov.ie, CC-BY 4.0), the same snapshot the web app uses.
Rules: An Garda Siochana's published warning signs for rental scams (scam_rules.json).
The logic lives in core.py; this file only exposes it as tools.

Run:
    pip install "mcp[cli]"
    python server.py                       # stdio (Copilot backend, Claude Desktop, Codex, Agents SDK MCPServerStdio)
    python server.py --http --port 8000    # streamable HTTP at http://localhost:8000/mcp
Works with the MCP Python SDK v1 (FastMCP) and v2 (MCPServer).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402

try:  # MCP Python SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # 1.x
    from mcp.server.fastmcp import FastMCP as _Server

server = _Server(
    "rentcheck",
    instructions=("Irish rental data and scam checks. Rent figures are RTB averages agreed in newly registered "
                  "tenancies (not asking prices), by area, bedrooms and property type; always quote the quarter. "
                  "No live listings are available. For scam questions, advise viewing in person before paying."),
)


@server.tool()
def find_areas(query: str) -> list[str]:
    """Search RTB area names (towns, Dublin neighbourhoods, counties). Returns up to 8 exact names to pass to other tools."""
    return core.find(query)


@server.tool()
def area_rents(area: str) -> dict:
    """All RTB average monthly rents for one area, by bedrooms and property type, with the quarter of each figure."""
    return core.area_rents(area)


@server.tool()
def rents_near(area: str | None = None, lat: float | None = None, lon: float | None = None,
               radius_km: float = 5, beds: str = "all", property_type: str = "all",
               budget_eur: float | None = None, sort: str = "closest") -> dict:
    """RTB average rents for areas within radius_km of an area name or a lat/lon point.
    beds: all|1|2|3|4. property_type: all|apt|house. sort: closest|cheapest|best_fit.
    With budget_eur, each area gets budget_status (within | close = up to 10% over | above) and best_fit puts
    areas within budget first. Returns areas with distance, rent and quarter, plus the median rent."""
    return core.rents_near(area, lat, lon, radius_km, beds, property_type, budget_eur, sort)


@server.tool()
def check_listing(text: str = "", price_eur: float | None = None, area: str = "",
                  beds: str = "2", kind: str = "apt") -> dict:
    """Check a rental listing for scam warning signs (Garda red flags in the text) and compare the price with
    RTB averages for the area. kind: apt|house|room. Returns score 0-100, level, flags with quoted evidence.
    Quotes are exact text from the listing; never paraphrase them as quotes."""
    return core.check_listing(text, price_eur, area, beds, kind)


@server.tool()
def data_info() -> dict:
    """Where the data comes from, what the figures mean and how current the snapshot is."""
    return core.data_info()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    if a.http:
        try:
            server.run(transport="streamable-http", port=a.port)
        except TypeError:  # SDK 1.x takes the port in settings
            server.settings.port = a.port
            server.run(transport="streamable-http")
    else:
        server.run()
