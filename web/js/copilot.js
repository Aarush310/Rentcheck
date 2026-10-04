/* RentCheck Copilot panel. Answers are structured: SUMMARY, KEY FIGURES (cards rendered from tool results),
   EVIDENCE, RECOMMENDATION, SOURCE. The cards and sources are built from what the tools returned, not from model text. */
(function () {
"use strict";
const { $, esc, icon, eur, state } = RC;
const panel = $("copilot"), body = $("cpBody"), input = $("cpInput");
let turns = [], ctl = null, busy = false;

/* ---------- context + suggestions ---------- */
function contextChips() {
  const c = [], l = state.listing;
  if (l) c.push(`<span class="chip ${RC.LEVELS[l.level].cls}">${icon(RC.LEVELS[l.level].icon)}Listing · ${RC.LEVELS[l.level].label} ${l.score}${l.price ? " · " + eur(l.price) : ""}</span>`);
  if (state.area) c.push(`<span class="chip">${icon("pin")}${esc(state.area)}</span>`);
  else if (state.pin) c.push(`<span class="chip">${icon("pin")}Map pin</span>`);
  else if (l && l.area) c.push(`<span class="chip">${icon("pin")}${esc(l.area)}</span>`);
  c.push(`<span class="chip">${esc(RC.describe(state.beds, state.type))}</span>`);
  if (state.budget) c.push(`<span class="chip">Budget ${eur(state.budget)}</span>`);
  if (state.pin) c.push(`<span class="chip">Within ${state.radius} km</span>`);
  $("cpContext").innerHTML = `<span class="cp-context-k">Using your context</span>${c.join("")}`;
}
function suggestions() {
  const l = state.listing, area = state.area || (l && l.area), short = area && RC.shortName(area), s = [];
  if (l) { s.push(l.level === "low" ? "Is this listing safe to pay for?" : "Why is this listing risky?"); if (l.price && area) s.push(`Is ${eur(l.price)} normal here?`); s.push("Where should I look instead?"); }
  if (area) {
    if (!l) s.push("Is this a good option?");
    s.push(state.budget ? `Find areas within ${eur(state.budget)}` : `Where can I find a cheaper ${RC.BEDS[state.beds] === "any size" ? "home" : RC.BEDS[state.beds]}?`);
    const other = RC.nearby(RC.PLACES[area], 12, state.beds, state.type).find(x => x.name !== area && x.r);
    if (other) s.push(`Compare this area with ${RC.shortName(other.name)}`);
  } else if (state.pin) s.push("What do rents look like near my pin?", state.budget ? `Find areas within ${eur(state.budget)}` : "Where is cheapest near my pin?");
  if (!s.length) s.push("What's a normal rent for a 2-bed apartment in Rathmines?", "Find areas within €1,500 near Tallaght", "How do I spot a rental scam?", "Where does the rent data come from?");
  void short;
  $("cpSuggest").innerHTML = [...new Set(s)].slice(0, 4).map(q => `<button type="button">${esc(q)}</button>`).join("");
  $("cpSuggest").querySelectorAll("button").forEach(b => b.addEventListener("click", () => ask(b.textContent)));
}
function modeBadge() {
  const st = RC.ai.status, b = $("cpMode");
  b.className = "cp-mode " + (st.ai ? "ai" : "grounded");
  b.innerHTML = st.ai ? `<i></i>${esc(st.model)} · MCP tools` : `<i></i>Grounded mode · no language model`;
}
function welcome() {
  const st = RC.ai.status;
  body.innerHTML = `<div class="cp-welcome"><h3>Ask about a rent, an area or a listing</h3>
    <p>${st.ai ? "Copilot calls RentCheck's tools over MCP for every figure, and shows which tool and which quarter each answer came from."
      : "No language model is connected, so Copilot answers straight from RentCheck's tools and RTB data. The figures and evidence are the same; the wording is simpler."}</p>
    <ul><li>${icon("db")}Rent figures: RTB / CSO RIQ02, ${esc(RC.latestLabel())}</li><li>${icon("doc")}Scam checks: fixed rules from Garda warning signs</li><li>${icon("tool")}Tools: ${RC.ai.TOOL_NAMES.join(", ")}</li></ul></div>`;
}

/* ---------- answer rendering ---------- */
// A label is a line that is only the label ("SUMMARY", "**Evidence**", "## Recommendation") or "Label: text".
const LABELS = /^\s*(?:#{1,4}\s*)?\**\s*(SUMMARY|KEY FIGURES|EVIDENCE|RECOMMENDATION|SOURCES?)\s*\**\s*(?::\s*\**\s*(.*))?$/i;
function sections(text) {
  const out = []; let cur = { label: "", lines: [] };
  for (const line of text.split("\n")) {
    const m = line.match(LABELS);
    if (m) { if (cur.label || cur.lines.length) out.push(cur); cur = { label: m[1].toUpperCase(), lines: m[2] ? [m[2]] : [] }; }
    else cur.lines.push(line);
  }
  if (cur.label || cur.lines.length) out.push(cur);
  return out.filter(s => !/^SOURCES?$/.test(s.label));   // the UI writes the source line itself, from the tools used
}
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/“([^”]+)”/g, '<q class="quote">$1</q>');
function sectionHTML(s) {
  let html = "", list = [];
  const flush = () => { if (list.length) { html += `<ul>${list.map(x => `<li>${inline(x)}</li>`).join("")}</ul>`; list = []; } };
  for (const raw of s.lines) { const line = raw.trim(); if (!line) { flush(); continue; } const b = line.match(/^[-•*]\s+(.*)$/); if (b) list.push(b[1]); else { flush(); html += `<p>${inline(line)}</p>`; } }
  flush();
  return html ? `<div class="sec">${s.label ? `<div class="sec-k">${esc(s.label === "SUMMARY" ? "Summary" : s.label.charAt(0) + s.label.slice(1).toLowerCase())}</div>` : ""}${html}</div>` : "";
}

function cardFor(ev, idx) {
  const { name, args = {}, result: r } = ev;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "";
  if (name === "rents_near" && r.areas) {
    const rows = r.areas.slice(0, 6), centre = r.centre ? RC.shortName(r.centre) : "your pin";
    if (!rows.length) return `<div class="card"><div class="card-k">Nearby areas</div><p class="muted">No RTB figures for ${esc(r.beds)} within ${r.radius_km} km of ${esc(centre)}.</p></div>`;
    return `<div class="card"><div class="card-k">${esc(r.beds)} ${esc(RC.TYPE_LABEL[r.property_type] || "home")} · within ${r.radius_km} km of ${esc(centre)}${r.budget_eur ? " · budget " + eur(r.budget_eur) : ""}</div>
      <table class="tbl"><thead><tr><th>Area</th><th>RTB rent</th><th>Distance</th>${r.budget_eur ? "<th>vs budget</th>" : "<th>Quarter</th>"}</tr></thead><tbody>${rows.map(a => `<tr>
        <td><button class="link" type="button" data-view="${esc(a.area)}" data-card="${idx}">${esc(RC.shortName(a.area))}</button></td><td class="num">${eur(a.rent_eur)}</td><td class="num">${a.km} km</td>
        ${r.budget_eur ? `<td><span class="badge ${RC.BUDGET[a.budget_status].cls}">${a.vs_budget_eur > 0 ? "+" + eur(a.vs_budget_eur) : a.vs_budget_eur < 0 ? "−" + eur(-a.vs_budget_eur) : "on budget"}</span></td>` : `<td class="num">${esc(a.quarter)}</td>`}</tr>`).join("")}</tbody></table>
      ${r.count > rows.length ? `<p class="muted small">${r.count - rows.length} more on the map · median ${eur(r.median_rent_eur)}</p>` : r.median_rent_eur != null ? `<p class="muted small">Median ${eur(r.median_rent_eur)} across ${r.count} area${r.count > 1 ? "s" : ""}</p>` : ""}
      <div class="card-actions"><button class="btn btn-secondary btn-sm" type="button" data-viewall="${idx}">${icon("pin")}View on map</button>
        ${rows.length > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-compare="${esc(rows[0].area)}|${esc(rows[1].area)}">Compare areas</button>` : ""}</div></div>`;
  }
  if (name === "area_rents" && r.rents) {
    const f = RC.ai.pick(r, state.beds, state.type), any = RC.ai.pick(r, "all", "all"), show = f || any;
    return `<div class="card"><div class="card-k">${esc(r.area)}</div>
      ${show ? `<div class="card-fig"><span class="v">${eur(show.rent)}</span><span class="u">/ month · ${esc(f ? RC.describe(state.beds, state.type) : "all homes")} · RTB average · ${esc(show.quarter)}</span></div>` : `<p class="muted">No headline figure published.</p>`}
      ${!f && show ? `<p class="muted small">No ${esc(RC.describe(state.beds, state.type))} figure is published for this area.</p>` : ""}
      <p class="muted small">${r.rents.length} RTB figure${r.rents.length === 1 ? "" : "s"} available for this area by size and type.</p>
      <div class="card-actions"><button class="btn btn-secondary btn-sm" type="button" data-view="${esc(r.area)}">${icon("pin")}View on map</button></div></div>`;
  }
  if (name === "check_listing" && r.level) {
    const b = r.benchmark, quoted = r.flags.filter(f => f.quote);
    return `<div class="card"><div class="card-k">Listing check</div><div class="card-risk">${RC.levelBadge(r.level)}<span class="num">${r.score} / 100</span></div>
      ${b && b.reference ? `<div class="kv"><div><span>${b.asking_eur != null ? "Asking rent" : "Benchmark area"}</span><b>${b.asking_eur != null ? eur(b.asking_eur) : esc(RC.shortName(b.area))}</b></div><div><span>RTB benchmark · ${esc(b.reference.quarter)}</span><b>${eur(b.reference.rent)}</b></div>${b.difference_pct != null ? `<div><span>Difference</span><b>${b.difference_pct === 0 ? "in line" : "~" + Math.abs(b.difference_pct) + "% " + (b.difference_pct < 0 ? "below" : "above")}</b></div>` : ""}</div><p class="muted small">${esc(b.basis)} in ${esc(b.area)}. RTB average of agreed rents, not an asking price.</p>` : b && b.note ? `<p class="muted small">${esc(b.note)}</p>` : ""}
      ${quoted.length ? `<ul class="card-flags">${quoted.slice(0, 4).map(f => `<li><b>${esc(f.title)}</b><q class="quote">${esc(f.quote)}</q></li>`).join("")}</ul>` : ""}</div>`;
  }
  if (name === "data_info" && r.latest_quarter) return `<div class="card"><div class="card-k">Rent data</div><div class="kv"><div><span>Source</span><b>RTB / CSO RIQ02</b></div><div><span>Snapshot to</span><b>${esc(r.latest_quarter)}</b></div><div><span>Areas</span><b>${r.areas}</b></div></div><p class="muted small">${esc(r.definition)}</p></div>`;
  return "";
}

function traceHTML(tools, running) {
  return tools.map(t => { const a = t.args || {}, hint = a.query || a.area || (a.lat != null ? "map pin" : "") || (t.name === "check_listing" ? "listing" : "");
    return `<span class="tool">${icon("tool")}${esc(t.name)}${hint ? `<small>${esc(String(hint).slice(0, 28))}</small>` : ""}</span>`; }).join("")
    + (running ? `<span class="tool running"><i class="spin"></i>Working</span>` : "");
}
function footHTML(tools, meta) {
  const names = [...new Set(tools.map(t => t.name))], tags = [];
  const quarters = new Set(); tools.forEach(t => JSON.stringify(t.result || "").replace(/20\d\d Q[1-4]/g, q => quarters.add(q)));
  if (names.some(n => ["area_rents", "rents_near", "data_info"].includes(n)) || (names.includes("check_listing") && quarters.size)) tags.push(RC.sourceTag([...quarters].sort().slice(-2).join(", ")));
  if (names.includes("check_listing") || (meta.sources || []).includes("rules") || (meta.sources || []).includes("garda")) tags.push(`<span class="source-tag">${icon("doc")}RentCheck scam checks · Garda warning signs</span>`);
  const how = meta.mode === "ai" ? `Written by ${esc(meta.model || "the language model")} from tool results via MCP` : "Grounded mode: composed directly from tool results, no language model";
  return `<div class="sec-k">Source</div><div class="src-tags">${tags.join("") || `<span class="muted small">No data lookups were needed for this answer.</span>`}</div>
    ${tags.length && quarters.size ? `<p class="muted small">RTB figures are average rents agreed in newly registered tenancies, not asking prices.</p>` : ""}
    ${(meta.unverified || []).length ? `<p class="notice small">${icon("caution")}Not traced to a tool result: ${meta.unverified.map(esc).join(", ")}. Rely on the figures in the cards above.</p>` : ""}
    <p class="how">${names.length ? `Tools used: ${names.map(esc).join(" → ")} · ` : ""}${how}</p>`;
}

function viewOnMap(ev, areaName) {
  const a = ev ? ev.args || {} : {}, r = ev ? ev.result : null, patch = {};
  if (a.beds && RC.BEDS[a.beds]) patch.beds = String(a.beds);
  if (a.property_type && RC.TYPE_LABEL[a.property_type]) patch.type = a.property_type;
  if (a.budget_eur) Object.assign(patch, { budget: Math.round(a.budget_eur), mode: "afford" });
  if (r && r.radius_km) patch.radius = Math.min(30, Math.round(r.radius_km));
  const name = areaName || (r && r.centre);
  if (name && RC.PLACES[name]) { const p = RC.PLACES[name]; Object.assign(patch, { area: name, pin: { lat: p.lat, lon: p.lon } }); }
  else if (a.lat != null) Object.assign(patch, { area: null, pin: { lat: +a.lat, lon: +a.lon } });
  RC.set(patch, "copilot"); RC.go("map");
  if (matchMedia("(max-width: 1100px)").matches) close();
}

/* ---------- conversation ---------- */
function scroll() { body.scrollTop = body.scrollHeight; }
async function ask(q) {
  q = String(q || "").trim(); if (!q || busy) return;
  open(true);
  if (body.querySelector(".cp-welcome")) body.innerHTML = "";
  const u = document.createElement("div"); u.className = "msg user"; u.textContent = q; body.appendChild(u);
  const m = document.createElement("div"); m.className = "msg bot";
  m.innerHTML = `<div class="trace"></div><div class="ans-summary"></div><div class="ans-cards"></div><div class="ans-rest"></div><div class="ans-foot"></div>`;
  body.appendChild(m);
  const [trace, sum, cards, rest, foot] = m.children, tools = []; let text = "", meta = { mode: RC.ai.status.ai ? "ai" : "grounded" }, notice = "";
  trace.innerHTML = traceHTML(tools, true); scroll();
  busy = true; ctl = new AbortController(); $("cpSend").hidden = true; $("cpStop").hidden = false; input.value = ""; autosize();
  const paint = () => { const s = sections(text); sum.innerHTML = notice + (s[0] ? sectionHTML(s[0]) : ""); rest.innerHTML = s.slice(1).map(sectionHTML).join(""); };
  try {
    await RC.ai.ask({ question: q, history: turns.slice(-10), context: RC.context(), signal: ctl.signal, onEvent(ev) {
      if (ev.type === "tool") {
        tools.push(ev); trace.innerHTML = traceHTML(tools, true);
        const html = cardFor(ev, tools.length - 1);
        if (html) { if (!cards.children.length) cards.insertAdjacentHTML("beforeend", `<div class="sec-k">Key figures</div>`); cards.insertAdjacentHTML("beforeend", html); }
      } else if (ev.type === "text") { text += ev.delta; paint(); }
      else if (ev.type === "notice") { notice = `<p class="notice small">${icon("caution")}${esc(ev.message)}</p>`; meta.mode = "grounded"; paint(); }
      else if (ev.type === "done") meta = Object.assign(meta, ev);
      else if (ev.type === "error") { notice = `<p class="notice small">${icon("caution")}${esc(ev.message)}</p>`; paint(); }
      scroll();
    } });
  } catch (e) { if (!e || e.name !== "AbortError") { notice = `<p class="notice small">${icon("caution")}Copilot couldn't answer just now. The checker and the map still work.</p>`; paint(); } }
  trace.innerHTML = traceHTML(tools, false);
  if (text || tools.length) { foot.innerHTML = footHTML(tools, meta); turns.push({ role: "user", content: q }, { role: "assistant", content: text || "(stopped)" }); }
  m.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => viewOnMap(b.dataset.card != null ? tools[+b.dataset.card] : null, b.dataset.view)));
  m.querySelectorAll("[data-viewall]").forEach(b => b.addEventListener("click", () => viewOnMap(tools[+b.dataset.viewall])));
  m.querySelectorAll("[data-compare]").forEach(b => b.addEventListener("click", () => { const [x, y] = b.dataset.compare.split("|"); ask(`Compare ${x} with ${y}`); }));
  busy = false; ctl = null; $("cpSend").hidden = false; $("cpStop").hidden = true; scroll(); suggestions();
}

function open(keepFocus) {
  if (panel.hidden) { panel.hidden = false; document.body.classList.add("cp-open"); requestAnimationFrame(() => panel.classList.add("in")); }
  contextChips(); suggestions(); modeBadge();
  if (!body.children.length) welcome();
  if (!keepFocus) input.focus({ preventScroll: true });
}
function close() { panel.classList.remove("in"); document.body.classList.remove("cp-open"); setTimeout(() => { panel.hidden = true; }, RC.reduced() ? 0 : 220); }
function autosize() { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; }

$("openCopilot").addEventListener("click", () => (panel.hidden ? open() : close()));
$("cpClose").addEventListener("click", close);
$("cpNew").addEventListener("click", () => { if (ctl) ctl.abort(); turns = []; body.innerHTML = ""; welcome(); suggestions(); });
$("cpStop").addEventListener("click", () => ctl && ctl.abort());
$("cpMode").addEventListener("click", () => RC.openSources());
$("cpForm").addEventListener("submit", ev => { ev.preventDefault(); ask(input.value); });
input.addEventListener("input", autosize);
input.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ask(input.value); } });
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !panel.hidden && !$("sourcesDlg").open) close(); });
RC.on(() => { if (!panel.hidden) { contextChips(); if (!busy) suggestions(); } });

RC.copilot = { open, close, ask, refresh() { modeBadge(); if (body.querySelector(".cp-welcome")) welcome(); } };
})();
