"""Refresh the rent figures used by the MCP server from a newer RIQ02 file.

    python fetch_rtb.py        # -> rtb_latest.csv (newest quarter per area, from the CSO)
    python update_data.py      # -> mcp_server/letcheck_data.json (keeps area positions)
"""
import csv
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "mcp_server" / "letcheck_data.json"
BEDS = {"all bedrooms": "all", "one bed": "1", "two bed": "2", "three bed": "3", "four plus bed": "4"}
TYPES = {"all property types": "all", "apartment": "apt", "other flats": "flat", "detached house": "det",
         "semi detached house": "semi", "terrace house": "terr"}

data = json.loads(DATA.read_text(encoding="utf-8"))
rents, latest = {}, 0
with (HERE / "rtb_latest.csv").open(encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        row = {k.strip().lower(): v for k, v in r.items()}
        b, t = BEDS.get(row["number of bedrooms"].strip().lower()), TYPES.get(row["property type"].strip().lower())
        m = re.search(r"(\d{4})\s*Q\s*([1-4])", row["quarter"])
        if not (b and t and m and row["value"].strip()):
            continue
        q = int(m[1]) * 10 + int(m[2])
        latest = max(latest, q)
        rents.setdefault(row["location"].strip(), {})[f"{b}|{t}"] = [round(float(row["value"])), q]
for loc in rents:
    rents[loc] = {k: v for k, v in rents[loc].items() if v[1] >= latest - 10}
data.update(rents=rents, latest=latest)
DATA.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
new = [n for n in rents if n not in data["places"]]
print(f"Updated to {latest // 10} Q{latest % 10}: {len(rents)} areas. {len(new)} have no map position yet.")
