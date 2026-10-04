"""Checks that the Python core (MCP server) and its JavaScript port (web app) return the same tool results,
and that every quoted piece of evidence is a literal slice of the listing. Needs node on PATH.

    python tests/test_parity.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mcp_server"))
import core  # noqa: E402

SCAM = """Lovely bright 2 bed apartment in Rathmines, fully furnished, all bills included. €950 per month.

Hi, thanks for your interest. I am currently working abroad in Spain with my company so unfortunately I can't show you the apartment myself. My agent will courier the keys to you once you pay the deposit and first month (€1,900) to secure it. Payment by Western Union or bank transfer. Lots of students are asking so please confirm fast. Contact me only on WhatsApp +34 600 000 000."""
OK = """Two-bed apartment, Rathmines, Dublin 6. €2,250 per month.

Viewings Tuesday and Thursday evenings with our letting agent; please book through the listing site. Deposit of one month's rent and first month's rent payable on signing the lease. Tenancy will be registered with the RTB. BER C2. References required."""

CASES = [
    ["find_areas", {"query": "rathmines"}], ["find_areas", {"query": "Co. Cork"}], ["find_areas", {"query": "zzzz"}],
    ["area_rents", {"area": "Clondalkin, Dublin 22"}], ["area_rents", {"area": "tallaght"}],
    ["rents_near", {"area": "Rathmines", "radius_km": 5, "beds": "2", "property_type": "apt"}],
    ["rents_near", {"area": "Athlone", "radius_km": 30, "beds": "3", "property_type": "house", "sort": "cheapest"}],
    ["rents_near", {"lat": 53.32, "lon": -6.39, "radius_km": 8, "beds": "2", "property_type": "apt", "budget_eur": 1800, "sort": "best_fit"}],
    ["rents_near", {"area": "Galway", "radius_km": 12, "budget_eur": 1500}],
    ["check_listing", {"text": SCAM, "price_eur": 950, "area": "Rathmines, Dublin 6", "beds": "2", "kind": "apt"}],
    ["check_listing", {"text": OK, "price_eur": 2250, "area": "Rathmines, Dublin 6", "beds": "2", "kind": "apt"}],
    ["check_listing", {"text": "Send the €500 deposit today to secure the property.", "price_eur": 1200, "area": "Tallaght", "beds": "2", "kind": "apt"}],
    ["check_listing", {"text": "Room in shared house, €700", "price_eur": 700, "area": "Maynooth", "beds": "1", "kind": "room"}],
    ["check_listing", {"text": "Nice house", "price_eur": 1500, "area": "Nowhereville", "beds": "4", "kind": "house"}],
    ["check_listing", {"text": "", "price_eur": 1300, "area": "Swords", "beds": "3", "kind": "house"}],
    ["data_info", {}],
]

JS = r"""
globalThis.window = globalThis;
require(process.argv.at(-1) + "/web/data/rentcheck-data.js");
require(process.argv.at(-1) + "/web/js/core.js");
const cases = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log(JSON.stringify(cases.map(([name, args]) => RC.tools[name](args))));
"""


def main() -> int:
    js = json.loads(subprocess.run(["node", "-e", JS, str(ROOT).replace("\\", "/")], input=json.dumps(CASES),
                                   capture_output=True, text=True, encoding="utf-8", check=True).stdout)
    py_tools = {"find_areas": lambda query: core.find(query), "area_rents": core.area_rents,
                "rents_near": core.rents_near, "check_listing": core.check_listing, "data_info": core.data_info}
    failed = 0
    for (name, args), got in zip(CASES, js):
        want = json.loads(json.dumps(py_tools[name](**args)))
        same = want == got
        quotes_ok = all(f["quote"] is None or f["quote"] in args.get("text", "") for f in want.get("flags", [])) if isinstance(want, dict) else True
        print(("ok   " if same and quotes_ok else "FAIL ") + name, json.dumps(args, ensure_ascii=False)[:70])
        if not same:
            print("  python:", json.dumps(want, ensure_ascii=False)[:600])
            print("  js    :", json.dumps(got, ensure_ascii=False)[:600])
        failed += not (same and quotes_ok)
    print(f"{len(CASES) - failed}/{len(CASES)} cases agree")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
