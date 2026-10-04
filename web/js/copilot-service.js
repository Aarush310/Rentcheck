/* Copilot service: one interface, two ways of answering.

     RC.ai.ask({question, history, context, signal, onEvent})  ->  events: tool | text | notice | done | error

   1. AI mode: the backend's Copilot agent (OpenAI Agents SDK) calls the RentCheck MCP server's tools and streams
      its answer. This is the only place a language model is used.
   2. Grounded mode (no backend, no API key, or the model fails): no language model at all. A small router picks
      the same RentCheck tools (RC.tools, the JS port of the MCP tools) and writes the answer from their results.

   Both emit the same tool events with real arguments and results, so the UI renders figures, evidence and
   sources from tool output in exactly the same way. Nothing here is mock data. */
(function () {
"use strict";
const { eur } = RC;
const status = { checked: false, backend: false, ai: false, model: null, mcp: false, mcp_tools: [], ai_reason: "No backend: the page was opened without the RentCheck server.", mcp_reason: "" };
const TOOL_NAMES = ["find_areas", "area_rents", "rents_near", "check_listing", "data_info"];

async function init() {
  const base = RC.config.apiBase;
  if (base != null) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(base + "/api/health", { signal: ctl.signal }); clearTimeout(t);
      if (r.ok) Object.assign(status, await r.json(), { backend: true });
    } catch (e) { status.ai_reason = "The RentCheck server is not reachable."; }
  }
  status.checked = true;
  return status;
}

/* ---------------- AI mode ---------------- */
async function remoteAsk({ question, history, context, signal, onEvent }) {
  const r = await fetch(RC.config.apiBase + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, context }), signal });
  if (!r.ok || !r.body) throw new Error("ai_unavailable");
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", got = false;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      if (!line.startsWith("data:")) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === "error" && !got) throw new Error("ai_failed");
      got = true; onEvent(ev);
    }
  }
}

/* ---------------- Grounded mode ---------------- */
const HOUSE = ["semi-detached house", "terraced house", "detached house"];
function pick(res, beds, type) {   // the figure for beds/type out of an area_rents result
  const rows = res.rents.filter(r => r.beds === RC.BEDS[beds]);
  if (type === "house") { const h = rows.filter(r => HOUSE.includes(r.type)); return h.length ? { rent: Math.round(h.reduce((s, r) => s + r.rent_eur, 0) / h.length), quarter: h.map(r => r.quarter).sort().pop() } : null; }
  const r = rows.find(x => x.type === (type === "apt" ? "apartment" : "any home")) || (type === "apt" ? rows.find(x => x.type === "other flat") : null);
  return r ? { rent: r.rent_eur, quarter: r.quarter } : null;
}
function understand(q, ctx) {
  const l = ctx.listing || {}, low = q.toLowerCase();
  const areas = RC.areasInText(q);
  const money = [...q.matchAll(/€\s?(\d[\d,]*)|\b(\d{1,2},\d{3}|\d{3,5})\s?(?:euro|eur\b|per month|a month|pm\b)/gi)].map(m => +(m[1] || m[2]).replace(/,/g, "")).filter(n => n >= 100 && n <= 20000);
  const bare = !money.length ? [...q.matchAll(/\b(\d{1,2},\d{3}|\d{3,5})\b/g)].map(m => +m[1].replace(/,/g, "")).filter(n => n >= 300 && n <= 20000) : [];
  const amount = money[0] || bare[0] || null;
  const budgetWords = /budget|afford|within|under|below|less than|up to|max/.test(low);
  const bm = low.match(/\b([1-4])\s*-?\s*bed/), beds = bm ? bm[1] : /\bone[- ]bed/.test(low) ? "1" : /\btwo[- ]bed/.test(low) ? "2" : /\bthree[- ]bed/.test(low) ? "3" : null;
  const type = /\b(apartment|flat|apt)\b/.test(low) ? "apt" : /\bhouse\b/.test(low) ? "house" : null;
  return { low, areas, amount, budgetWords,
    area: areas[0] || ctx.area || l.area || null, usedCtxArea: !areas[0] && !!(ctx.area || l.area),
    beds: beds || ctx.beds || l.beds || "2", type: type || ctx.property_type || (l.kind === "house" ? "house" : l.kind === "apt" ? "apt" : "all"),
    budget: (budgetWords && amount) || ctx.budget_eur || null, asking: !budgetWords && amount ? amount : null };
}
const DATA_Q = /\b(rtb|riq02|cso)\b|\bdata\b|source|asking prices?|how (current|recent|old|up to date)|live listings?|daft|come from|accurate/;
const GARDA ="View the property in person and check the keys work before paying, pay traceably, and if you have already been scammed contact your bank and your local Garda station.";
const NOT_ASKING = "RTB averages are rents agreed in new tenancies; asking prices are usually higher, so expect listings above these figures.";

function groundedAnswer(question, ctx, call) {
  const u = understand(question, ctx), l = ctx.listing, desc = RC.describe(u.beds, u.type), S = [];
  const sec = (label, body) => body && S.push(label + "\n" + body);
  const done = () => S.join("\n");

  // 1. General scam advice
  if (/(how (do|can|to)|what are).*(spot|avoid|tell|sign|scam)|warning signs|been scammed|already (paid|sent)/.test(u.low) && !(l && /this|listing/.test(u.low))) {
    sec("SUMMARY", "Gardaí's main warning signs: being asked for money before a viewing, an owner who is abroad or can't show the property, keys sent by post or courier, untraceable payment methods, pressure to decide fast, and a rent far below the area's norm.");
    sec("RECOMMENDATION", GARDA + " Paste the listing into the checker and RentCheck will quote the exact phrases that match these signs.");
    return { text: done(), sources: ["garda"] };
  }
  // 2. The checked listing
  if (l && (l.text || l.price_eur) && /risk|scam|suspicious|safe|legit|genuine|trust|listing|should i pay|send (the )?money|deposit|fake/.test(u.low)) {
    const r = call("check_listing", { text: l.text || "", price_eur: l.price_eur || undefined, area: l.area || "", beds: l.beds, kind: l.kind });
    const L = RC.LEVELS[r.level];
    sec("SUMMARY", `${L.label}, score ${r.score} / 100. ${r.flags.length ? `RentCheck's checks found ${r.flags.length} warning sign${r.flags.length > 1 ? "s" : ""}.` : "None of the warning-sign rules matched, which is not proof the listing is genuine."}`);
    sec("EVIDENCE", r.flags.slice(0, 5).map(f => `- **${f.title}**${f.quote ? `: “${f.quote}”` : ""}`).join("\n"));
    sec("RECOMMENDATION", (r.level === "high" ? "Do not pay yet. Don't send money or documents. " : r.level === "caution" ? "Proceed carefully and don't pay anything before a viewing. " : "") + GARDA);
    return { text: done(), sources: ["rules"] };
  }
  // 3. Compare two areas
  if (/compare|\bvs\b|versus|difference between/.test(u.low)) {
    const pair = u.areas.length >= 2 ? u.areas.slice(0, 2) : u.areas.length === 1 && (ctx.area || (l && l.area)) && (ctx.area || l.area) !== u.areas[0] ? [ctx.area || l.area, u.areas[0]] : null;
    if (!pair) { sec("SUMMARY", "Name two areas to compare, for example “Compare Tallaght with Clondalkin”, or select one on the map and name the other."); return { text: done() }; }
    const [A, B] = pair.map(a => call("area_rents", { area: a })), a = pick(A, u.beds, u.type), b = pick(B, u.beds, u.type), n = x => RC.shortName(x.area);
    if (a && b) {
      const d = a.rent - b.rent, cheaper = d > 0 ? B : A, pct = Math.round(Math.abs(d) / Math.max(a.rent, b.rent) * 100);
      sec("SUMMARY", d === 0 ? `For a ${desc}, ${n(A)} and ${n(B)} have the same RTB average: ${eur(a.rent)} a month.` : `For a ${desc}, ${n(cheaper)} is cheaper: the RTB averages are ${eur(a.rent)} in ${n(A)} (${a.quarter}) and ${eur(b.rent)} in ${n(B)} (${b.quarter}), a gap of ${eur(Math.abs(d))} a month (~${pct}%).`);
      if (u.budget) sec("EVIDENCE", [[A, a], [B, b]].map(([X, x]) => `- ${n(X)}: ${eur(x.rent)}, ${x.rent <= u.budget ? eur(u.budget - x.rent) + " under" : eur(x.rent - u.budget) + " over"} your ${eur(u.budget)} budget`).join("\n"));
    } else sec("SUMMARY", `The RTB has no ${desc} figure for ${[!a && n(A), !b && n(B)].filter(Boolean).join(" or ")} (small samples are withheld), so I can't compare like with like. The cards show what is published for each.`);
    sec("RECOMMENDATION", NOT_ASKING);
    return { text: done(), sources: ["rtb"] };
  }
  // 4. Is this price normal?
  if (u.asking && u.area && !/where|cheaper|alternativ/.test(u.low)) {
    const r = call("check_listing", { price_eur: u.asking, area: u.area, beds: u.beds, kind: u.type === "house" ? "house" : "apt" }), b = r.benchmark;
    if (!b || !b.reference) { sec("SUMMARY", b ? `The RTB has no figure for a ${desc} in ${b.area}, so I can't benchmark ${eur(u.asking)}.` : `I couldn't find an RTB area matching that. Try the nearest town.`); return { text: done(), sources: ["rtb"] }; }
    const p = b.difference_pct, where = `${b.basis} in ${RC.shortName(b.area)}`;
    sec("SUMMARY", `${eur(u.asking)} is ${p === 0 ? "in line with" : "~" + Math.abs(p) + "% " + (p < 0 ? "below" : "above")} the RTB average of ${eur(b.reference.rent)} for a ${where} (${b.reference.quarter}).`);
    sec("EVIDENCE", p <= -40 ? "- A rent this far below the area average is one of the warning signs Gardaí describe." : p <= -20 ? "- Noticeably cheaper than the area average. Not proof of a scam, but be extra careful." : p <= 5 ? "- That is in the normal range for the area." : "- Above the RTB average, which is common: asking prices usually sit above agreed rents.");
    sec("RECOMMENDATION", (p <= -20 ? "Treat it with care and paste the full listing into the checker. " : "") + "The RTB figure is an average rent agreed in newly registered tenancies, not an asking price. " + (p <= -20 ? GARDA : ""));
    return { text: done(), sources: p <= -20 ? ["rtb", "rules"] : ["rtb"] };
  }
  // 6. About the data
  if (DATA_Q.test(u.low) && !u.areas[0]) {
    const d = call("data_info", {});
    sec("SUMMARY", `RentCheck uses the ${d.source}. The stored snapshot runs to ${d.latest_quarter} and covers ${d.areas} areas. It is not a live feed.`);
    sec("EVIDENCE", "- The figures are average rents agreed in newly registered tenancies, not asking prices; advertised rents are usually higher.\n- The RTB withholds small samples and publishes nothing for rooms in shared homes.\n- RentCheck has no live listings: sites such as Daft don't openly license their data.");
    return { text: done(), sources: ["rtb"] };
  }
  // 5. Where should I look / what fits my budget
  if (/where|cheaper|cheapest|alternativ|afford|instead|look|within|under|budget|nearby|near\b|around/.test(u.low)) {
    const pin = !u.areas[0] && !ctx.area && ctx.pin ? ctx.pin : null;
    if (!u.area && !pin) { sec("SUMMARY", "Tell me where to start: name an area (for example “near Tallaght”), or select one on the rent map, and I'll list the RTB averages around it."); return { text: done() }; }
    const base = { beds: u.beds, property_type: u.type, sort: u.budget ? "best_fit" : "cheapest" };
    if (u.budget) base.budget_eur = u.budget;
    Object.assign(base, pin ? { lat: pin.lat, lon: pin.lon } : { area: u.area });
    let radius = Math.max(5, +ctx.radius_km || 5), r = call("rents_near", { ...base, radius_km: radius }), widened = false;
    if ((u.budget ? !r.within_budget_count : r.count < 3) && radius < 15) { radius = 15; widened = true; r = call("rents_near", { ...base, radius_km: radius }); }
    const centre = r.centre ? RC.shortName(r.centre) : "your pin", own = r.centre ? r.areas.find(a => a.area === r.centre) : null, others = r.areas.filter(a => a.area !== r.centre);
    if (!r.count) { sec("SUMMARY", `The RTB has no ${desc} figures within ${radius} km of ${centre}. Try a different size or a wider radius on the map.`); return { text: done(), sources: ["rtb"] }; }
    if (u.budget) {
      const fit = others.filter(a => a.budget_status === "within");
      sec("SUMMARY", (own ? `${centre} itself averages ${eur(own.rent_eur)} for a ${desc} (${own.quarter}), ${own.vs_budget_eur > 0 ? eur(own.vs_budget_eur) + " over" : eur(-own.vs_budget_eur) + " under"} your ${eur(u.budget)} budget. ` : "")
        + (fit.length ? `Based on the RTB data, ${fit.length} other area${fit.length > 1 ? "s" : ""} within ${radius} km ${fit.length > 1 ? "are" : "is"} within budget.` : `No other area within ${radius} km has an RTB average within ${eur(u.budget)} for a ${desc}.`) + (widened ? ` I widened the search to ${radius} km.` : ""));
      sec("EVIDENCE", (fit.length ? fit : others).slice(0, 3).map(a => `- ${RC.shortName(a.area)}: ${eur(a.rent_eur)} (${a.quarter}), ${a.km} km away, ${a.vs_budget_eur > 0 ? eur(a.vs_budget_eur) + " over" : eur(-a.vs_budget_eur) + " under"} budget`).join("\n"));
      sec("RECOMMENDATION", (fit.length ? "Open the closest matches on the map and compare them. " : "Consider a smaller home, a wider radius or a higher budget. ") + NOT_ASKING);
    } else {
      sec("SUMMARY", `The lowest RTB averages for a ${desc} within ${radius} km of ${centre} are ${(others.length ? others : r.areas).slice(0, 3).map(a => `${a.area} (${eur(a.rent_eur)})`).join("; ")}. The median across ${r.count} areas is ${eur(r.median_rent_eur)}.` + (widened ? ` I widened the search to ${radius} km.` : ""));
      sec("RECOMMENDATION", "Set a monthly budget on the map to see which areas fit it. " + NOT_ASKING);
    }
    return { text: done(), sources: ["rtb"] };
  }
  // 7. An area: what do rents look like, is it a good option
  if (u.area) {
    const A = call("area_rents", { area: u.area }), a = pick(A, u.beds, u.type), name = RC.shortName(A.area);
    const args = { area: A.area, radius_km: Math.max(5, +ctx.radius_km || 5), beds: u.beds, property_type: u.type, sort: u.budget ? "best_fit" : "closest" };
    if (u.budget) args.budget_eur = u.budget;
    const N = call("rents_near", args), others = N.areas.filter(x => x.area !== A.area);
    if (!a) { sec("SUMMARY", `The RTB has no ${desc} figure for ${name} (small samples are withheld). The card shows the sizes and types it does publish.`); return { text: done(), sources: ["rtb"] }; }
    let s = `The RTB average for a ${desc} in ${name} is ${eur(a.rent)} a month (${a.quarter}).`;
    if (u.budget) { const st = RC.budgetStatus(a.rent, u.budget), d = a.rent - u.budget; s += ` That is ${st === "within" ? "within" : st === "close" ? "close to" : "above"} your ${eur(u.budget)} budget (${d > 0 ? eur(d) + " over" : eur(-d) + " under"}).`; }
    sec("SUMMARY", s);
    const ev = [];
    if (N.median_rent_eur != null && N.count > 1) { const d = a.rent - N.median_rent_eur; ev.push(`- ${d === 0 ? "In line with" : eur(Math.abs(d)) + (d < 0 ? " below" : " above")} the median of ${N.count} areas within ${N.radius_km} km (${eur(N.median_rent_eur)}).`); }
    const fit = u.budget ? others.filter(x => x.budget_status === "within") : [];
    if (u.budget && a.rent > u.budget) ev.push(fit.length ? `- Within budget nearby: ${fit.slice(0, 3).map(x => `${RC.shortName(x.area)} (${eur(x.rent_eur)}, ${x.km} km)`).join(", ")}.` : `- No area within ${N.radius_km} km has an average within budget.`);
    sec("EVIDENCE", ev.join("\n"));
    sec("RECOMMENDATION", (u.budget && a.rent > u.budget && fit.length ? "Nearby areas may offer better value; open them on the map. " : "") + NOT_ASKING);
    return { text: done(), sources: ["rtb"] };
  }
  sec("SUMMARY", "I can answer from RentCheck's data: the RTB average rent for an area, areas that fit a budget, a comparison of two areas, whether a price is normal, or why a checked listing is risky. Name an area or try one of the suggestions.");
  return { text: done() };
}

async function localAsk({ question, context, signal, onEvent }) {
  const events = [];
  const call = (name, args) => { const result = RC.tools[name](args); events.push({ type: "tool", name, args, result }); return result; };
  let out;
  try { out = groundedAnswer(question, context || {}, call); }
  catch (e) { out = { text: "SUMMARY\n" + (e && e.message ? e.message : "I couldn't work that out from the data.") }; }
  const pause = ms => new Promise(r => setTimeout(r, RC.reduced() ? 0 : ms));
  for (const ev of events) { if (signal && signal.aborted) return; onEvent(ev); await pause(160); }
  const words = out.text.split(/(?<=\s)/);
  for (let i = 0; i < words.length; i += 3) { if (signal && signal.aborted) return; onEvent({ type: "text", delta: words.slice(i, i + 3).join("") }); await pause(14); }
  onEvent({ type: "done", mode: "grounded", unverified: [] });
}

async function ask(opts) {
  if (status.ai) {
    try { return await remoteAsk(opts); }
    catch (e) {
      if (e && e.name === "AbortError") return;
      opts.onEvent({ type: "notice", message: "The language model didn't respond, so this answer comes straight from RentCheck's tools (grounded mode)." });
    }
  }
  return localAsk(opts);
}
async function secondOpinion(text) {
  const r = await fetch(RC.config.apiBase + "/api/second-opinion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error("unavailable");
  return (await r.json()).flags || [];
}

RC.ai = { status, init, ask, secondOpinion, TOOL_NAMES, pick };
})();
