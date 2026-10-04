/* RentCheck data layer: RTB rent lookups, geography and the deterministic scam checks.
   A JavaScript port of mcp_server/core.py (tests/test_parity.py checks they agree), so the checker and the map
   work instantly and offline. RC.tools mirrors the five MCP tools one-for-one, with the same result shapes.
   No language model is involved anywhere in this file. */
(function (root) {
"use strict";
const BASE = root.RENTCHECK_DATA, RULESET = root.RENTCHECK_RULES;
const PLACES = BASE.places;                       // name -> {lat, lon, p: place|district|county}
const PLACE_NAMES = Object.keys(PLACES);
const store = { rents: BASE.rents, latest: BASE.latest, label: "built-in snapshot" };
const KEY = "rentcheck.rents.v2";
try {
  const s = JSON.parse(root.localStorage.getItem(KEY) || "null");
  if (s && s.rents && s.latest > store.latest) Object.assign(store, { rents: s.rents, latest: s.latest, label: s.label || "loaded file" });
} catch (e) {}

const BEDS = { all: "any size", "1": "1-bed", "2": "2-bed", "3": "3-bed", "4": "4+ bed" };
const TYPE_KEYS = { all: ["all"], apt: ["apt", "flat"], house: ["semi", "terr", "det"] };
const TYPE_NAMES = { all: "any home", apt: "apartment", flat: "other flat", det: "detached house", semi: "semi-detached house", terr: "terraced house" };
const TYPE_LABEL = { all: "home", apt: "apartment", house: "house" };
const DEFINITION = "Average rents agreed in newly registered tenancies (RTB / CSO RIQ02). These are not asking prices; advertised rents are usually higher.";
const POSITION_NOTE = "Positions are approximate area centres. RTB withholds figures for small samples.";
const ADVICE = "View in person and check the keys work before paying anything; verify who you're dealing with; pay traceably (ideally credit card); report scams to your local Garda station and your bank. A clean result is not proof a listing is genuine.";
const CLOSE_TO_BUDGET = 0.10;
const RULES = RULESET.rules.map(r => Object.assign({}, r, { re: new RegExp(r.pattern, "i") }));

const qlabel = q => `${Math.floor(q / 10)} Q${q % 10}`;
const eur = n => "€" + Math.round(n).toLocaleString("en-IE");
const describe = (beds, type) => `${BEDS[beds] || BEDS.all} ${TYPE_LABEL[type] || "home"}`;

function rentFor(loc, beds, type) {
  const r = store.rents[loc]; if (!r) return null;
  const keys = TYPE_KEYS[type] || ["all"];
  if (type === "house") {
    const vals = keys.map(k => r[`${beds}|${k}`]).filter(Boolean);
    if (!vals.length) return null;
    return { value: Math.round(vals.reduce((s, v) => s + v[0], 0) / vals.length), q: Math.max(...vals.map(v => v[1])), basis: vals.length > 1 ? "average of house types" : "house" };
  }
  for (const k of keys) { const v = r[`${beds}|${k}`]; if (v) return { value: v[0], q: v[1], basis: k }; }
  return null;
}
function km(a, b) {
  const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function nearby(pt, radius, beds, type) {
  return PLACE_NAMES.filter(n => PLACES[n].p !== "county")
    .map(n => ({ name: n, d: km(pt, PLACES[n]), lat: PLACES[n].lat, lon: PLACES[n].lon, r: rentFor(n, beds, type) }))
    .filter(x => x.d <= radius).sort((a, b) => a.d - b.d);
}
const norm = s => String(s || "").toLowerCase().replace(/\bco\.?\s+/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function findAreas(q, limit = 8) {
  const n = norm(q); if (!n) return [];
  const scored = [];
  for (const name of PLACE_NAMES) {
    const m = norm(name); let s = 0;
    if (m === n) s = 100; else if (m.startsWith(n)) s = 80; else if (m.split(" ").some(w => w.startsWith(n))) s = 60; else if (m.includes(n)) s = 40;
    else { const toks = n.split(" "); const hit = toks.filter(t => m.includes(t)).length; if (hit) s = 20 * hit / toks.length; }
    if (s > 0) scored.push([s - (PLACES[name].p === "county" ? 5 : 0), name]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
}
function resolve(input) { if (!input || !String(input).trim()) return null; if (PLACES[input]) return input; return findAreas(input, 1)[0] || null; }
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
function budgetStatus(rent, budget) { return rent <= budget ? "within" : rent <= budget * (1 + CLOSE_TO_BUDGET) ? "close" : "above"; }

/* Area names mentioned in free text ("…apartment in Rathmines…"). Longest match first; counties only as a last resort. */
const MENTION = PLACE_NAMES.map(n => ({ name: n, key: norm(n.split(",")[0]), county: PLACES[n].p === "county" }))
  .filter(x => x.key.length >= 4).sort((a, b) => (a.county - b.county) || (b.key.length - a.key.length));
function areasInText(text) {
  const t = " " + norm(text) + " ", hits = [];
  for (const m of MENTION) {
    const i = t.indexOf(" " + m.key + " ");
    if (i >= 0 && !hits.some(h => h.key.includes(m.key))) hits.push({ name: m.name, key: m.key, at: i, county: m.county });
  }
  const full = PLACE_NAMES.filter(n => n.includes(",") && t.includes(" " + norm(n) + " "));   // "Rathmines, Dublin 6" beats "Rathmines"
  const out = hits.sort((a, b) => (a.county - b.county) || (a.at - b.at)).map(h => full.find(f => norm(f.split(",")[0]) === h.key) || h.name);
  return [...new Set(out)];
}
function priceInText(text) {
  const m = String(text).match(/€\s?(\d{1,2},?\d{3}|\d{3})(?:\.\d\d)?\s*(?:per month|a month|\/ ?month|pm\b|p\.m\.|pcm|monthly)/i)
    || String(text).match(/(?:rent|price)[^.\n€]{0,20}€\s?(\d{1,2},?\d{3}|\d{3})/i);
  return m ? +m[1].replace(",", "") : null;
}

function sentenceAround(text, i, len) {
  const s = Math.max(text.lastIndexOf(".", i), text.lastIndexOf("!", i), text.lastIndexOf("?", i), text.lastIndexOf("\n", i)) + 1;
  let e = text.slice(i + len).search(/[.!?\n]/); e = e < 0 ? text.length : i + len + e + 1;
  return text.slice(s, e).trim().slice(0, 220);
}

/* The listing check used by the UI. Flags carry the exact sentence from the listing as evidence. */
function assess({ text = "", price, location = "", beds = "2", kind = "apt" }) {
  text = String(text).trim();
  const flags = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) flags.push({ id: r.id, severity: r.severity, w: r.weight, title: r.title, why: r.why, quote: sentenceAround(text, m.index, m[0].length) });
  }
  let bench = null;
  const loc = resolve(location);
  if (loc) {
    let ref = null, basis = null;
    if (kind !== "room") {
      ref = rentFor(loc, beds, kind); basis = `${BEDS[beds]} ${kind === "apt" ? "apartment" : "house"}`;
      if (!ref) { ref = rentFor(loc, beds, "all"); basis = `${BEDS[beds]} home (any type)`; }
    }
    bench = { loc, ref, basis: ref ? basis : null, allHomes: rentFor(loc, "all", "all") };
    if (ref && isFinite(price) && price > 0) {
      const diff = (price - ref.value) / ref.value, pct = Math.round(-diff * 100), P = RULESET.price;
      bench.asking = Math.round(price); bench.diff = diff; bench.diffPct = Math.round(diff * 100);
      const base = `Registered rents for this size of home in ${loc} average €${ref.value.toLocaleString("en-US")} a month (${qlabel(ref.q)}). `;
      if (diff <= -P.serious_below) flags.unshift({ id: "price", severity: "serious", w: P.serious_weight, title: `Rent is ${pct}% below the area average`, quote: null, why: base + "Gardaí warn that unrealistically low prices are a classic sign of a scam." });
      else if (diff <= -P.warning_below) flags.unshift({ id: "price", severity: "warning", w: P.warning_weight, title: `Rent is ${pct}% below the area average`, quote: null, why: base + "Cheaper than usual isn't proof of a scam, but be extra careful." });
    } else if (kind === "room") bench.note = "The RTB publishes no figures for rooms in shared homes, so no price check for rooms.";
    else if (!ref) bench.note = "The RTB has no figure for this size of home in this area (small samples are withheld).";
  }
  const score = Math.min(100, flags.reduce((s, f) => s + f.w, 0));
  const T = RULESET.thresholds;
  return { score, level: score >= T.high ? "high" : score >= T.caution ? "caution" : "low", flags, bench, resolvedLocation: loc };
}

/* ---- The five RentCheck tools, same names and result shapes as the MCP server ---- */
const tools = {
  find_areas: ({ query }) => findAreas(String(query || "")),
  area_rents: ({ area }) => {
    const loc = resolve(area); if (!loc) throw new Error(`Unknown area '${area}'. Call find_areas first.`);
    const rows = Object.entries(store.rents[loc] || {}).map(([k, [v, q]]) => { const [b, t] = k.split("|"); return { beds: BEDS[b], type: TYPE_NAMES[t], rent_eur: v, quarter: qlabel(q) }; })
      .sort((a, b) => (a.beds < b.beds ? -1 : a.beds > b.beds ? 1 : a.rent_eur - b.rent_eur));
    return { area: loc, rents: rows, source: BASE.source, definition: DEFINITION };
  },
  rents_near: ({ area, lat, lon, radius_km = 5, beds = "all", property_type = "all", budget_eur, sort = "closest" }) => {
    let pt, centre = null;
    if (lat != null && lon != null) pt = { lat: +lat, lon: +lon };
    else { centre = resolve(area); if (!centre) throw new Error("Give an area name (see find_areas) or lat and lon."); pt = PLACES[centre]; }
    beds = BEDS[String(beds)] ? String(beds) : "all"; property_type = TYPE_KEYS[property_type] ? property_type : "all";
    radius_km = Math.max(1, Math.min(40, +radius_km || 5));
    const budget = budget_eur ? +budget_eur : null;
    const out = nearby(pt, radius_km, beds, property_type).filter(x => x.r).map(x => {
      const row = { area: x.name, km: Math.round(x.d * 10) / 10, rent_eur: x.r.value, quarter: qlabel(x.r.q) };
      if (budget) { row.budget_status = budgetStatus(x.r.value, budget); row.vs_budget_eur = x.r.value - Math.round(budget); }
      return row;
    });
    const med = median(out.map(x => x.rent_eur)), order = { within: 0, close: 1, above: 2 };
    if (sort === "cheapest") out.sort((a, b) => a.rent_eur - b.rent_eur || a.km - b.km);
    else if (sort === "best_fit" && budget) out.sort((a, b) => order[a.budget_status] - order[b.budget_status] || (a.budget_status === "within" ? a.km - b.km : a.rent_eur - b.rent_eur));
    else sort = "closest";
    const res = { centre, beds: BEDS[beds], property_type, radius_km, count: out.length, median_rent_eur: med == null ? null : Math.round(med), sort, areas: out.slice(0, 25), note: POSITION_NOTE, definition: DEFINITION };
    if (budget) { res.budget_eur = Math.round(budget); res.within_budget_count = out.filter(x => x.budget_status === "within").length; res.budget_rule = "within = at or under budget; close = up to 10% over; above = more than 10% over"; }
    return res;
  },
  check_listing: ({ text = "", price_eur, area = "", beds = "2", kind = "apt" }) => {
    beds = BEDS[String(beds)] ? String(beds) : "2"; kind = ["apt", "house", "room"].includes(kind) ? kind : "apt";
    const r = assess({ text, price: +price_eur, location: area, beds, kind }), b = r.bench;
    let benchmark = null;
    if (b) {
      benchmark = { area: b.loc, reference: b.ref ? { rent: b.ref.value, quarter: qlabel(b.ref.q) } : null, basis: b.basis, definition: DEFINITION };
      if (b.asking != null) { benchmark.asking_eur = b.asking; benchmark.difference_pct = b.diffPct; }
      if (b.note) benchmark.note = b.note;
    }
    return { score: r.score, level: r.level, flags: r.flags.map(f => ({ severity: f.severity, title: f.title, why: f.why, quote: f.quote })), benchmark, advice: ADVICE,
      method: "Deterministic RentCheck scam checks based on Garda warning signs; quotes are exact text from the listing." };
  },
  data_info: () => ({ source: BASE.source, latest_quarter: qlabel(store.latest), areas: Object.keys(store.rents).length, definition: DEFINITION,
    snapshot: "A stored RTB snapshot, not a live feed. Refresh with fetch_rtb.py then update_data.py.", positions: "Area positions are approximate area centres.",
    live_listings: "Not included: listing sites such as Daft don't openly license their data." }),
};

/* ---- Loading a newer RIQ02 CSV in the browser ---- */
const BMAP = { "all bedrooms": "all", "one bed": "1", "two bed": "2", "three bed": "3", "four plus bed": "4" };
const TMAP = { "all property types": "all", "apartment": "apt", "other flats": "flat", "detached house": "det", "semi detached house": "semi", "terrace house": "terr" };
function splitCSVLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  out.push(cur); return out;
}
function ingestRIQ02(text) {
  text = text.replace(/^﻿/, ""); const nl = text.indexOf("\n");
  const head = splitCSVLine(text.slice(0, nl).replace(/\r$/, "")).map(h => h.trim().toLowerCase());
  const ci = { q: head.indexOf("quarter"), b: head.indexOf("number of bedrooms"), t: head.indexOf("property type"), l: head.indexOf("location"), v: head.indexOf("value") };
  if (nl < 0 || Object.values(ci).some(i => i < 0)) throw new Error("This doesn't look like the RTB rent report (RIQ02). Expected columns Quarter, Number of Bedrooms, Property Type, Location and VALUE.");
  const best = {}; let maxQ = 0, pos = nl + 1;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos); if (end < 0) end = text.length; const line = text.slice(pos, end).replace(/\r$/, ""); pos = end + 1; if (!line) continue;
    const r = splitCSVLine(line), v = parseFloat(r[ci.v]); if (!isFinite(v) || v <= 0) continue;
    const b = BMAP[(r[ci.b] || "").trim().toLowerCase()], t = TMAP[(r[ci.t] || "").trim().toLowerCase()]; if (!b || !t) continue;
    const m = String(r[ci.q]).match(/(\d{4})\s*Q\s*([1-4])/i); if (!m) continue; const q = (+m[1]) * 10 + (+m[2]);
    const loc = r[ci.l].trim(), k = b + "|" + t; best[loc] = best[loc] || {};
    if (!best[loc][k] || q > best[loc][k][1]) best[loc][k] = [Math.round(v), q]; if (q > maxQ) maxQ = q;
  }
  for (const loc of Object.keys(best)) for (const k of Object.keys(best[loc])) if (best[loc][k][1] < maxQ - 10) delete best[loc][k];
  if (!maxQ) throw new Error("Found the columns but no usable rent figures.");
  return { rents: best, latest: maxQ };
}
function useData(d, label) {
  Object.assign(store, { rents: d.rents, latest: d.latest, label });
  try { root.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
}

root.RC = Object.assign(root.RC || {}, {
  PLACES, PLACE_NAMES, COUNTIES: BASE.counties, SOURCE: BASE.source, BEDS, TYPE_LABEL, DEFINITION, CLOSE_TO_BUDGET, RULES, store,
  qlabel, eur, describe, rentFor, km, nearby, findAreas, resolve, median, budgetStatus, areasInText, priceInText, assess, tools, ingestRIQ02, useData,
  latestLabel: () => qlabel(store.latest),
});
})(typeof window !== "undefined" ? window : globalThis);
