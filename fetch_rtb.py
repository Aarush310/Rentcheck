"""Download the RTB Average Monthly Rent Report (CSO table RIQ02, listed on data.gov.ie, CC-BY 4.0)
and keep only the latest figure for each location x bedrooms x property type.

    python fetch_rtb.py            # writes rtb_latest.csv next to this script (drop it into LetCheck)

Standard library only. The full file is large, so it is streamed line by line.
"""
import csv
import io
import re
import sys
import urllib.request
from pathlib import Path

URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/CSV/1.0/en"
OUT = Path(__file__).resolve().parent / "rtb_latest.csv"


def qnum(q: str) -> int:
    m = re.search(r"(\d{4})\s*Q\s*([1-4])", q, re.I)
    return int(m[1]) * 10 + int(m[2]) if m else -1


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "LetCheck/0.1 (Build for Ireland prototype)"})
    print("Downloading RIQ02 from the CSO (this can take a minute)...")
    with urllib.request.urlopen(req, timeout=300) as r:
        reader = csv.reader(io.TextIOWrapper(r, encoding="utf-8-sig", newline=""))
        header = next(reader)
        low = [h.strip().lower() for h in header]
        try:
            iq, ib, it, il, iv = (low.index("quarter"), low.index("number of bedrooms"),
                                  low.index("property type"), low.index("location"), low.index("value"))
        except ValueError:
            sys.exit(f"Unexpected columns: {header}")
        best, n = {}, 0
        for row in reader:
            n += 1
            if not row or not row[iv].strip():
                continue
            key = (row[il], row[ib], row[it])
            q = qnum(row[iq])
            if key not in best or q > qnum(best[key][iq]):
                best[key] = row
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(header)
        w.writerows(best.values())
    latest = max(qnum(r[iq]) for r in best.values())
    print(f"Read {n:,} rows. Saved {len(best):,} latest figures (newest quarter {latest // 10} Q{latest % 10}) -> {OUT.name}")
    print("Now open LetCheck, click 'Load RTB rent data' and drop rtb_latest.csv in.")


if __name__ == "__main__":
    main()
