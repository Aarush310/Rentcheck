"""LetCheck MCP server: Irish rental data and scam checks as tools for any MCP client
(ChatGPT / OpenAI Agents, Claude Desktop, Codex, Cursor ...).

Data: RTB Average Monthly Rent Report (CSO table RIQ02, data.gov.ie, CC-BY 4.0), the same snapshot the web app uses.
Rules: An Garda Siochana's published warning signs for rental scams.

Run:
    pip install "mcp[cli]"
    python server.py                       # stdio (Claude Desktop, Codex, Agents SDK MCPServerStdio)
    python server.py --http --port 8000    # streamable HTTP at http://localhost:8000/mcp
Works with the MCP Python SDK v1 (FastMCP) and v2 (MCPServer).
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from statistics import median

try:  # MCP Python SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # 1.x
    from mcp.server.fastmcp import FastMCP as _Server

DATA = json.loads((Path(__file__).with_name("letcheck_data.json")).read_text(encoding="utf-8"))
PLACES: dict = DATA["places"]
RENTS: dict = DATA["rents"]
LATEST: int = DATA["latest"]
TYPE_KEYS = {"all": ["all"], "apt": ["apt", "flat"], "house": ["semi", "terr", "det"]}
TYPE_NAMES = {"all": "any home", "apt": "apartment", "flat": "other flat", "det": "detached house",
              "semi": "semi-detached house", "terr": "terraced house"}
BEDS = {"all": "any size", "1": "1-bed", "2": "2-bed", "3": "3-bed", "4": "4+ bed"}


def qlabel(q: int) -> str:
    return f"{q // 10} Q{q % 10}"


def norm(s: str) -> str:
    s = re.sub(r"\bco\.?\s+", "", (s or "").lower()).replace("'", "").replace("\u2019", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def find(query: str, limit: int = 8) -> list[str]:
    n = norm(query)
    if not n:
        return []
    scored = []
    for name, p in PLACES.items():
        m = norm(name)
        if m == n:
            s = 100
        elif m.startswith(n):
            s = 80
        elif any(w.startswith(n) for w in m.split()):
            s = 60
        elif n in m:
            s = 40
        else:
            toks = n.split()
            hit = sum(t in m for t in toks)
            s = 20 * hit / len(toks) if hit else 0
        if s:
            scored.append((s - (5 if p["p"] == "county" else 0), name))
    return [n for _, n in sorted(scored, key=lambda x: -x[0])[:limit]]


def resolve(area: str) -> str | None:
    if area in PLACES:
        return area
    hits = find(area, 1)
    return hits[0] if hits else None


def rent_for(loc: str, beds: str, ptype: str) -> dict | None:
    r = RENTS.get(loc)
    if not r:
        return None
    keys = TYPE_KEYS.get(ptype, ["all"])
    if ptype == "house":
        vals = [r[f"{beds}|{k}"] for k in keys if f"{beds}|{k}" in r]
        if not vals:
            return None
        return {"rent": round(sum(v[0] for v in vals) / len(vals)), "quarter": qlabel(max(v[1] for v in vals))}
    for k in keys:
        v = r.get(f"{beds}|{k}")
        if v:
            return {"rent": v[0], "quarter": qlabel(v[1])}
    return None


def km(a: dict, b: dict) -> float:
    r = math.radians
    h = (math.sin(r(b["lat"] - a["lat"]) / 2) ** 2
         + math.cos(r(a["lat"])) * math.cos(r(b["lat"])) * math.sin(r(b["lon"] - a["lon"]) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(h))


RULES = [
    ("serious", 30, "Wants money before you've viewed it",
     r"\b(deposit|payment|pay|transfer|send|money)\b[^.?!\n]{0,80}\b(before (?:any |the |a |you )?(view|viewing|seeing|see|meet|meeting|arriv)|prior to (?:any |the |a )?view|to (secure|reserve|hold) (it|the (room|flat|apartment|house|property|place)|your))|\b(secure|reserve|hold) (it|the (room|flat|apartment|house|property|place))\b[^.?!\n]{0,40}\b(deposit|payment|pay)\b"),
    ("serious", 25, "Can't or won't show the property",
     r"\b(working|living|currently|i am|i'm|we are|we're|based)\b[^.?!\n]{0,40}\b(abroad|overseas|out of the country|outside ireland|in (spain|france|germany|the uk|london|dubai|italy|nigeria|usa|canada|poland))\b|\b(can(?:'|no)?t|cannot|unable to|not possible to|no)\b[^.?!\n]{0,30}\b(view|viewing|viewings|show you|show the)\b|\bvirtual (tour|viewing)\b|\bvideo (tour|viewing) only\b"),
    ("serious", 20, "Keys sent by post or courier",
     r"\b(keys?)\b[^.?!\n]{0,60}\b(post|posted|courier|couriered|mail|mailed|dhl|fedex|an post|delivered|send(ing)? (you|them))\b|\b(courier|post|mail)\b[^.?!\n]{0,30}\bkeys?\b"),
    ("serious", 25, "Untraceable payment method",
     r"\b(western union|moneygram|money ?gram|crypto|bitcoin|btc|usdt|gift ?cards?|friends (and|&) family|cash only|ria money|worldremit)\b"),
    ("warning", 10, "Pressure to decide quickly",
     r"\b(lots of|many|several|other) (people|students|applicants|enquiries|interest)\b|\b(first come|first to pay|first person to|asap|as soon as possible|today only|urgent(ly)?|hurry|won't last|will go fast|confirm (fast|quickly|today))\b"),
    ("warning", 8, "Moves you off the platform",
     r"\b(whats ?app|telegram|signal|text me|email me|contact me) (only|directly)\b|\bonly (on|via|through) (whats ?app|email|telegram)\b|\bwhats ?app\b[^.?!\n]{0,20}\+\d"),
    ("warning", 12, "Asks for ID or bank documents early",
     r"\b(send|copy of|scan of|photo of)\b[^.?!\n]{0,30}\b(passport|id card|driving licen[cs]e|bank statement|pps)\b"),
    ("warning", 12, "Says a booking site or 'agent' will handle the deposit",
     r"\b(airbnb|booking\.com|vrbo)\b[^.?!\n]{0,60}\b(deposit|payment|pay|hold|secure)\b"),
]
RULES = [(s, w, t, re.compile(p, re.I)) for s, w, t, p in RULES]


def sentence(text: str, i: int, n: int) -> str:
    s = max(text.rfind(c, 0, i + 1) for c in ".!?\n") + 1
    m = re.search(r"[.!?\n]", text[i + n:])
    e = len(text) if not m else i + n + m.end()
    return text[s:e].strip()[:220]


server = _Server(
    "letcheck",
    instructions=("Irish rental data and scam checks. Rent figures are RTB averages agreed in newly registered "
                  "tenancies (not asking prices), by area, bedrooms and property type; always quote the quarter. "
                  "No live listings are available. For scam questions, advise viewing in person before paying."),
)


@server.tool()
def find_areas(query: str) -> list[str]:
    """Search RTB area names (towns, Dublin neighbourhoods, counties). Returns up to 8 exact names to pass to other tools."""
    return find(query)


@server.tool()
def area_rents(area: str) -> dict:
    """All RTB average monthly rents for one area, by bedrooms and property type, with the quarter of each figure."""
    loc = resolve(area)
    if not loc:
        raise ValueError(f"Unknown area '{area}'. Call find_areas first.")
    rows = []
    for k, (v, q) in RENTS.get(loc, {}).items():
        b, t = k.split("|")
        rows.append({"beds": BEDS[b], "type": TYPE_NAMES[t], "rent_eur": v, "quarter": qlabel(q)})
    return {"area": loc, "rents": sorted(rows, key=lambda x: (x["beds"], x["rent_eur"])),
            "source": DATA["source"]}


@server.tool()
def rents_near(area: str | None = None, lat: float | None = None, lon: float | None = None,
               radius_km: float = 5, beds: str = "all", property_type: str = "all") -> dict:
    """RTB average rents for areas within radius_km of an area name or a lat/lon point.
    beds: all|1|2|3|4. property_type: all|apt|house. Returns nearest areas with distance and the median rent."""
    if lat is not None and lon is not None:
        pt = {"lat": float(lat), "lon": float(lon)}
    else:
        loc = resolve(area or "")
        if not loc:
            raise ValueError("Give an area name (see find_areas) or lat and lon.")
        pt = PLACES[loc]
    beds = beds if beds in BEDS else "all"
    property_type = property_type if property_type in TYPE_KEYS else "all"
    radius_km = max(1.0, min(40.0, float(radius_km)))
    out = []
    for name, p in PLACES.items():
        if p["p"] == "county":
            continue
        d = km(pt, p)
        if d <= radius_km:
            r = rent_for(name, beds, property_type)
            if r:
                out.append({"area": name, "km": round(d, 1), "rent_eur": r["rent"], "quarter": r["quarter"]})
    out.sort(key=lambda x: x["km"])
    return {"beds": BEDS[beds], "property_type": property_type, "radius_km": radius_km, "count": len(out),
            "median_rent_eur": round(median(x["rent_eur"] for x in out)) if out else None, "areas": out[:25],
            "note": "Positions are approximate area centres. RTB withholds figures for small samples."}


@server.tool()
def check_listing(text: str = "", price_eur: float | None = None, area: str = "",
                  beds: str = "2", kind: str = "apt") -> dict:
    """Check a rental listing for scam warning signs (Garda red flags in the text) and compare the price with
    RTB averages for the area. kind: apt|house|room. Returns score 0-100, level, flags with quoted evidence."""
    flags, score = [], 0
    for sev, w, title, rx in RULES:
        m = rx.search(text or "")
        if m:
            flags.append({"severity": sev, "title": title, "quote": sentence(text, m.start(), len(m.group(0)))})
            score += w
    bench = None
    loc = resolve(area) if area else None
    if loc:
        ref = None if kind == "room" else (rent_for(loc, beds, kind) or rent_for(loc, beds, "all"))
        bench = {"area": loc, "reference": ref}
        if ref and price_eur:
            diff = (price_eur - ref["rent"]) / ref["rent"]
            bench["difference_pct"] = round(diff * 100)
            if diff <= -0.4:
                flags.insert(0, {"severity": "serious", "title": f"Rent is {round(-diff*100)}% below the area average", "quote": None})
                score += 30
            elif diff <= -0.2:
                flags.insert(0, {"severity": "warning", "title": f"Rent is {round(-diff*100)}% below the area average", "quote": None})
                score += 15
        elif kind == "room":
            bench["note"] = "The RTB publishes no figures for rooms in shared homes, so no price check for rooms."
    score = min(100, score)
    return {"score": score, "level": "high" if score >= 50 else "caution" if score >= 20 else "low",
            "flags": flags, "benchmark": bench,
            "advice": ("View in person and check the keys work before paying anything; verify who you're dealing "
                       "with; pay traceably (ideally credit card); report scams to your local Garda station and your bank.")}


@server.tool()
def data_info() -> dict:
    """Where the data comes from and how current it is."""
    return {"source": DATA["source"], "latest_quarter": qlabel(LATEST), "areas": len(RENTS),
            "live_listings": "Not included: listing sites such as Daft don't openly license their data."}


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
