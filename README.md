# LetCheck

Check a rental listing against the rents people actually pay, before you send any money.
Built at Build for Ireland, Dogpatch Labs, 4 October 2026.

## What's in it

| Part | What it does |
|---|---|
| `web/index.html` | Single-page app: **listing checker**, **rent heatmap** (click anywhere for rents around the pin), **AI assistant** with tools. Works offline; data embedded. |
| `mcp_server/server.py` | **MCP server** exposing the same data and checks as tools: `find_areas`, `area_rents`, `rents_near`, `check_listing`, `data_info`. Stdio or streamable HTTP. |
| `mcp_server/assistant_openai.py` | The assistant on **OpenAI** (Agents SDK), getting every figure from the MCP server. |
| `fetch_rtb.py`, `update_data.py` | Refresh to the newest RTB quarter from the CSO. |

## Run
```bash
# web app
open web/index.html

# MCP server
pip install "mcp[cli]"
python mcp_server/server.py                    # stdio: Claude Desktop, Codex, Cursor, Agents SDK
python mcp_server/server.py --http --port 8000 # http://localhost:8000/mcp

# OpenAI assistant over MCP
pip install openai-agents
export OPENAI_API_KEY=...                      # keep keys out of the repo
python mcp_server/assistant_openai.py "Is €950 for a 2-bed apartment in Rathmines a scam risk?"
```
Claude Desktop config: `{"mcpServers": {"letcheck": {"command": "python", "args": ["/path/to/mcp_server/server.py"]}}}`.
For ChatGPT or the OpenAI Responses API's remote MCP tool, run the HTTP mode behind a public HTTPS URL (e.g. a tunnel).

## Data
- **Rents:** RTB Average Monthly Rent Report, CSO table RIQ02, listed on data.gov.ie (CC-BY 4.0). Average rents agreed in **newly registered tenancies**, by area (336 towns, Dublin neighbourhoods and counties), bedrooms and property type. The embedded snapshot runs to **2025 Q3**, taken from a public mirror of the RIQ02 extract (github.com/SiddarthSharma1308/ireland-housing-crisis-analysis); run `fetch_rtb.py` then `update_data.py` (or drop the CSV into the web app) to move to the newest quarter.
- **Map:** county outlines from open GeoJSON (jonnymccullagh/ireland-counties-geojson); area positions from GeoNames-derived place data plus Dublin postal-district centres. Positions are approximate area centres, labelled as such.
- **Not used:** live listings from Daft or similar. They don't offer an open listings licence and their terms don't allow scraping, so a safety tool shouldn't depend on them.
- **Scam rules and advice:** An Garda Síochána, August 2026 (230+ reports and €400,000+ losses, Jan–Jul 2026; provisional).

## Architecture
```
data.gov.ie / CSO RIQ02 ─► fetch_rtb.py ─► letcheck_data.json (rents + area positions)
                                              │
              ┌───────────────────────────────┼─────────────────────────────┐
              ▼                               ▼                             ▼
   web app: checker + heatmap         MCP server (5 tools)          web assistant (Claude in the
   + "rents around your pin"          ▲          ▲                  viewer, page functions as tools)
                                      │          │
                      OpenAI Agents SDK      Claude Desktop / Codex / ChatGPT (HTTP)
```
The AI never produces a figure itself: every rent comes from a tool call, and AI-flagged listing text must match the listing word for word.

## Limits
- A clean result isn't proof a listing is real. Always view in person and check the keys work before paying.
- RTB figures are agreed rents, usually below asking prices, so a listing far below the RTB average is a strong warning.
- No RTB figures exist for rooms in shared homes, and the RTB withholds small samples, so some areas lack some sizes.

## Credits
RTB / CSO (RIQ02, CC-BY 4.0) via data.gov.ie; county outlines: github.com/jonnymccullagh/ireland-counties-geojson; place positions: GeoNames-derived data (github.com/lutangar/cities.json); scam advice: An Garda Síochána.

Never commit API keys: put `OPENAI_API_KEY` in your environment or a `.env` file (ignored by git).
