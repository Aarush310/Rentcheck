"""RentCheck core: the rent data model and the deterministic scam checks.

Standard library only, so it can be imported by the MCP server, the web backend and the tests.
Nothing here calls a language model. Every rent figure returned comes straight from the RTB snapshot in
rentcheck_data.json; every quoted piece of evidence is a literal slice of the listing text.

The web app carries a JavaScript port of this file (web/js/core.js). tests/test_parity.py checks they agree.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "rentcheck_data.json").read_text(encoding="utf-8"))
_RULES_FILE = json.loads((HERE / "scam_rules.json").read_text(encoding="utf-8"))

PLACES: dict = DATA["places"]   # name -> {lat, lon, p: place|district|county}
RENTS: dict = DATA["rents"]     # name -> {"<beds>|<type>": [rent_eur, quarter]}
LATEST: int = DATA["latest"]    # e.g. 20253 = 2025 Q3
SOURCE: str = DATA["source"]

TYPE_KEYS = {"all": ["all"], "apt": ["apt", "flat"], "house": ["semi", "terr", "det"]}
TYPE_NAMES = {"all": "any home", "apt": "apartment", "flat": "other flat", "det": "detached house",
              "semi": "semi-detached house", "terr": "terraced house"}
BEDS = {"all": "any size", "1": "1-bed", "2": "2-bed", "3": "3-bed", "4": "4+ bed"}

DEFINITION = ("Average rents agreed in newly registered tenancies (RTB / CSO RIQ02). "
              "These are not asking prices; advertised rents are usually higher.")
POSITION_NOTE = "Positions are approximate area centres. RTB withholds figures for small samples."
ADVICE = ("View in person and check the keys work before paying anything; verify who you're dealing "
          "with; pay traceably (ideally credit card); report scams to your local Garda station and your bank. "
          "A clean result is not proof a listing is genuine.")
CLOSE_TO_BUDGET = 0.10   # "close to budget" = up to 10% over

THRESHOLDS = _RULES_FILE["thresholds"]
PRICE_RULE = _RULES_FILE["price"]
RULES = [dict(r, rx=re.compile(r["pattern"], re.I)) for r in _RULES_FILE["rules"]]


def rnd(x: float) -> int:
    """Round half up, matching JavaScript's Math.round (Python's round() is banker's rounding)."""
    return math.floor(x + 0.5)


def qlabel(q: int) -> str:
    return f"{q // 10} Q{q % 10}"


def norm(s: str) -> str:
    s = re.sub(r"\bco\.?\s+", "", (s or "").lower()).replace("'", "").replace("’", "")
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
    if not area or not str(area).strip():
        return None
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
        return {"rent": rnd(sum(v[0] for v in vals) / len(vals)), "quarter": qlabel(max(v[1] for v in vals))}
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


def median(vals: list[float]) -> float | None:
    s = sorted(vals)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def budget_status(rent: float, budget: float) -> str:
    """within | close (up to 10% over) | above."""
    if rent <= budget:
        return "within"
    return "close" if rent <= budget * (1 + CLOSE_TO_BUDGET) else "above"


def sentence(text: str, i: int, n: int) -> str:
    """The sentence of `text` that contains the match at [i, i+n). Always a literal slice of the text."""
    s = max(text.rfind(c, 0, i + 1) for c in ".!?\n") + 1
    m = re.search(r"[.!?\n]", text[i + n:])
    e = len(text) if not m else i + n + m.end()
    return text[s:e].strip()[:220]


# ----------------------------------------------------------------------------- tool implementations

def area_rents(area: str) -> dict:
    loc = resolve(area)
    if not loc:
        raise ValueError(f"Unknown area '{area}'. Call find_areas first.")
    rows = []
    for k, (v, q) in RENTS.get(loc, {}).items():
        b, t = k.split("|")
        rows.append({"beds": BEDS[b], "type": TYPE_NAMES[t], "rent_eur": v, "quarter": qlabel(q)})
    return {"area": loc, "rents": sorted(rows, key=lambda x: (x["beds"], x["rent_eur"])),
            "source": SOURCE, "definition": DEFINITION}


def rents_near(area: str | None = None, lat: float | None = None, lon: float | None = None,
               radius_km: float = 5, beds: str = "all", property_type: str = "all",
               budget_eur: float | None = None, sort: str = "closest") -> dict:
    centre = None
    if lat is not None and lon is not None:
        pt = {"lat": float(lat), "lon": float(lon)}
    else:
        centre = resolve(area or "")
        if not centre:
            raise ValueError("Give an area name (see find_areas) or lat and lon.")
        pt = PLACES[centre]
    beds = str(beds) if str(beds) in BEDS else "all"
    property_type = property_type if property_type in TYPE_KEYS else "all"
    radius_km = max(1.0, min(40.0, float(radius_km)))
    budget = float(budget_eur) if budget_eur else None
    out = []
    for name, p in PLACES.items():
        if p["p"] == "county":
            continue
        d = km(pt, p)
        if d <= radius_km:
            r = rent_for(name, beds, property_type)
            if r:
                row = {"area": name, "km": round(d, 1), "rent_eur": r["rent"], "quarter": r["quarter"]}
                if budget:
                    row["budget_status"] = budget_status(r["rent"], budget)
                    row["vs_budget_eur"] = r["rent"] - rnd(budget)
                out.append(row)
    med = median([x["rent_eur"] for x in out])
    order = {"within": 0, "close": 1, "above": 2}
    if sort == "cheapest":
        out.sort(key=lambda x: (x["rent_eur"], x["km"]))
    elif sort == "best_fit" and budget:
        out.sort(key=lambda x: (order[x["budget_status"]], x["km"] if x["budget_status"] == "within" else x["rent_eur"]))
    else:
        sort = "closest"
        out.sort(key=lambda x: x["km"])
    res = {"centre": centre, "beds": BEDS[beds], "property_type": property_type, "radius_km": radius_km,
           "count": len(out), "median_rent_eur": rnd(med) if med is not None else None, "sort": sort,
           "areas": out[:25], "note": POSITION_NOTE, "definition": DEFINITION}
    if budget:
        res["budget_eur"] = rnd(budget)
        res["within_budget_count"] = sum(x["budget_status"] == "within" for x in out)
        res["budget_rule"] = "within = at or under budget; close = up to 10% over; above = more than 10% over"
    return res


def check_listing(text: str = "", price_eur: float | None = None, area: str = "",
                  beds: str = "2", kind: str = "apt") -> dict:
    text = (text or "").strip()
    flags, score = [], 0
    for r in RULES:
        m = r["rx"].search(text)
        if m:
            flags.append({"severity": r["severity"], "title": r["title"], "why": r["why"],
                          "quote": sentence(text, m.start(), len(m.group(0)))})
            score += r["weight"]
    bench = None
    beds = str(beds) if str(beds) in BEDS else "2"
    kind = kind if kind in ("apt", "house", "room") else "apt"
    loc = resolve(area) if area else None
    if loc:
        ref, basis = None, None
        if kind != "room":
            ref = rent_for(loc, beds, kind)
            basis = f"{BEDS[beds]} {'apartment' if kind == 'apt' else 'house'}"
            if not ref:
                ref, basis = rent_for(loc, beds, "all"), f"{BEDS[beds]} home (any type)"
        bench = {"area": loc, "reference": ref, "basis": basis if ref else None, "definition": DEFINITION}
        if ref and price_eur:
            diff = (price_eur - ref["rent"]) / ref["rent"]
            bench["asking_eur"] = rnd(price_eur)
            bench["difference_pct"] = rnd(diff * 100)
            pct = rnd(-diff * 100)
            if diff <= -PRICE_RULE["serious_below"]:
                flags.insert(0, {"severity": "serious", "title": f"Rent is {pct}% below the area average", "quote": None,
                                 "why": (f"Registered rents for this size of home in {loc} average €{ref['rent']:,} a month "
                                         f"({ref['quarter']}). Gardaí warn that unrealistically low prices are a classic sign of a scam.")})
                score += PRICE_RULE["serious_weight"]
            elif diff <= -PRICE_RULE["warning_below"]:
                flags.insert(0, {"severity": "warning", "title": f"Rent is {pct}% below the area average", "quote": None,
                                 "why": (f"Registered rents for this size of home in {loc} average €{ref['rent']:,} a month "
                                         f"({ref['quarter']}). Cheaper than usual isn't proof of a scam, but be extra careful.")})
                score += PRICE_RULE["warning_weight"]
        elif kind == "room":
            bench["note"] = "The RTB publishes no figures for rooms in shared homes, so no price check for rooms."
        elif not ref:
            bench["note"] = "The RTB has no figure for this size of home in this area (small samples are withheld)."
    score = min(100, score)
    level = "high" if score >= THRESHOLDS["high"] else "caution" if score >= THRESHOLDS["caution"] else "low"
    return {"score": score, "level": level, "flags": flags, "benchmark": bench, "advice": ADVICE,
            "method": "Deterministic RentCheck scam checks based on Garda warning signs; quotes are exact text from the listing."}


def data_info() -> dict:
    return {"source": SOURCE, "latest_quarter": qlabel(LATEST), "areas": len(RENTS), "definition": DEFINITION,
            "snapshot": "A stored RTB snapshot, not a live feed. Refresh with fetch_rtb.py then update_data.py.",
            "positions": "Area positions are approximate area centres.",
            "live_listings": "Not included: listing sites such as Daft don't openly license their data."}
