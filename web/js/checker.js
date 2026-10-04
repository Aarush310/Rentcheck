/* Listing checker UI. The analysis itself is RC.assess (deterministic rules + RTB benchmark) in core.js. */
(function () {
"use strict";
const { $, esc, icon, eur, qlabel, LEVELS } = RC;

const EX = {
  scam: { text: `Lovely bright 2 bed apartment in Rathmines, fully furnished, all bills included. €950 per month.

Hi, thanks for your interest. I am currently working abroad in Spain with my company so unfortunately I can't show you the apartment myself. My agent will courier the keys to you once you pay the deposit and first month (€1,900) to secure it. Payment by Western Union or bank transfer. Lots of students are asking so please confirm fast. Contact me only on WhatsApp +34 600 000 000.`, loc: "Rathmines, Dublin 6", price: "950", kind: "apt", beds: "2" },
  ok: { text: `Two-bed apartment, Rathmines, Dublin 6. €2,250 per month.

Viewings Tuesday and Thursday evenings with our letting agent; please book through the listing site. Deposit of one month's rent and first month's rent payable on signing the lease. Tenancy will be registered with the RTB. BER C2. References required.`, loc: "Rathmines, Dublin 6", price: "2250", kind: "apt", beds: "2" },
};
const VERDICT = {
  high: { headline: "Do not pay yet.", sub: "This listing shows several signs Gardaí associate with rental scams.",
    next: "Don't send money or documents. Ask for an in-person viewing, and walk away if the advertiser refuses or keeps pushing for payment." },
  caution: { headline: "Proceed carefully.", sub: "There are some warning signs here.",
    next: "Only continue if you can view the property in person and verify who you're dealing with. Don't pay anything before then." },
  low: { headline: "No major warning signs found.", sub: "That is not proof the listing is genuine.",
    next: "Still view it in person, check that the keys work, and pay in a way you can trace before you commit." },
};
let aiFlags = [], lastText = "";

const dl = $("locs"); RC.PLACE_NAMES.slice().sort().forEach(n => dl.appendChild(new Option(n)));

function readForm() {
  const text = $("text").value.trim();
  let price = RC.parseMoney($("price").value), loc = $("loc").value.trim();
  $("priceHint").textContent = "Optional"; $("locHint").textContent = "Town or Dublin area";
  if (!price && text) { const p = RC.priceInText(text); if (p) { price = p; $("price").value = p.toLocaleString("en-IE"); $("priceHint").textContent = "Read from the listing text"; } }
  if (!loc && text) { const a = RC.areasInText(text)[0]; if (a) { loc = a; $("loc").value = a; $("locHint").textContent = "Read from the listing text"; } }
  return { text, price, location: loc, beds: $("beds").value, kind: $("kind").value };
}

function benchmarkHTML(res, input) {
  const b = res.bench;
  if (!input.location) return `<p class="muted">Add the area to compare the rent with the RTB average.</p>`;
  if (!b) return `<p class="notice">${icon("caution")}No RTB area matches “${esc(input.location)}”. Try a nearby town or a Dublin neighbourhood from the list.</p>`;
  if (!b.ref) {
    const ctx = b.allHomes ? `<p class="muted">For context only: the average for all homes in ${esc(b.loc)} is <b>${eur(b.allHomes.value)}</b> (${qlabel(b.allHomes.q)}).</p>` : "";
    return `<p class="notice">${icon("caution")}${esc(b.note)}</p>${ctx}${RC.sourceTag(b.allHomes ? qlabel(b.allHomes.q) : "")}`;
  }
  const q = qlabel(b.ref.q), hasAsk = b.asking != null;
  let diff = "", bars = "";
  if (hasAsk) {
    const pct = Math.abs(b.diffPct), cls = b.diff <= -0.4 ? "high" : b.diff <= -0.2 ? "caution" : "neutral";
    const note = b.diff <= -0.2 ? "Unusually cheap for the area. Treat with care."
      : b.diff < 0.05 ? "In the normal range for the area." : "Above the RTB average, which is common: asking prices usually sit above agreed rents.";
    diff = `<div class="diff ${cls}"><b>${pct === 0 ? "In line with" : "~" + pct + "% " + (b.diff < 0 ? "below" : "above")} benchmark</b><span>${note}</span></div>`;
    const max = Math.max(b.asking, b.ref.value);
    bars = `<div class="cmp" aria-hidden="true">
      <div class="cmp-row"><span>Asking</span><div class="cmp-track"><i class="ask ${cls}" style="--w:${(b.asking / max * 100).toFixed(1)}%"></i></div></div>
      <div class="cmp-row"><span>RTB</span><div class="cmp-track"><i class="rtb" style="--w:${(b.ref.value / max * 100).toFixed(1)}%"></i></div></div></div>`;
  }
  return `<div class="figures">
      ${hasAsk ? `<div class="figure"><span class="k">Asking rent</span><span class="v">${eur(b.asking)}</span><span class="u">per month</span></div>` : ""}
      <div class="figure"><span class="k">RTB area benchmark</span><span class="v">${eur(b.ref.value)}</span><span class="u">${esc(b.basis)} · ${esc(RC.shortName(b.loc))}</span></div>
    </div>${bars}${diff}
    <p class="src">${RC.sourceTag(q)} RTB figures represent average rents agreed in newly registered tenancies, not current asking prices.</p>`;
}

function flagsHTML(flags, bench) {
  if (!flags.length) return `<p class="muted">None of RentCheck's warning-sign rules matched this listing.</p>`;
  return `<ol class="flags">` + flags.map((f, i) => {
    const sev = f.ai ? `<span class="badge info">AI spotted</span>` : `<span class="badge ${f.severity === "serious" ? "high" : "caution"}">${f.severity === "serious" ? "Serious" : "Warning"}</span>`;
    const ev = f.quote ? `<blockquote data-mark="${i}">${esc(f.quote)}</blockquote>`
      : bench && bench.asking != null ? `<p class="evidence-data">Asking ${eur(bench.asking)} vs RTB ${eur(bench.ref.value)} (${qlabel(bench.ref.q)})</p>` : "";
    return `<li class="flag" style="--i:${i}"><span class="flag-n">${i + 1}</span><div><div class="flag-title">${esc(f.title)} ${sev}</div>${ev}<p class="why"><b>Why this matters:</b> ${esc(f.why)}</p></div></li>`;
  }).join("") + `</ol>`;
}

function markListing(text, flags) {
  const groups = new Map();
  flags.forEach((f, i) => { if (f.quote) { if (!groups.has(f.quote)) groups.set(f.quote, { nums: [], serious: false }); const g = groups.get(f.quote); g.nums.push(i + 1); g.serious = g.serious || f.severity === "serious"; } });
  let html = esc(text);
  for (const [q, g] of groups) { const e = esc(q); if (e && html.includes(e)) html = html.replace(e, `<mark class="${g.serious ? "serious" : "warning"}" data-nums="${g.nums.join(",")}">${e}<sup>${g.nums.join(" ")}</sup></mark>`); }
  return html;
}

function render(input, res, flags, score) {
  const level = score >= 50 ? "high" : score >= 20 ? "caution" : "low", L = LEVELS[level], V = VERDICT[level];
  const area = res.resolvedLocation;
  const aiReady = RC.ai && RC.ai.status.ai && input.text;
  $("resultEmpty").hidden = true;
  const body = $("resultBody"); body.hidden = false;
  body.innerHTML = `
    <div class="verdict ${L.cls}">
      <div class="verdict-top"><span class="risk-label">${icon(L.icon)}${L.label}</span><span class="score"><b id="scoreNum">0</b><span>/ 100</span></span></div>
      <div class="gauge" role="img" aria-label="Risk score ${score} out of 100. Caution from 20, high risk from 50."><span class="gauge-fill" id="gaugeFill"></span><i style="left:20%"></i><i style="left:50%"></i></div>
      <div class="gauge-scale"><span style="left:0">Low</span><span style="left:20%">Caution</span><span style="left:50%">High risk</span></div>
      <p class="headline">${V.headline}</p><p class="verdict-sub">${V.sub}</p>
    </div>
    <section class="block next"><h3>Recommended next step</h3><p>${V.next}</p>
      <div class="actions">
        <button class="btn btn-primary" type="button" id="toMap">${icon("pin")}${area ? "Explore this area" : "Explore rents on the map"}</button>
        <button class="btn btn-secondary" type="button" id="toCopilot">${icon("chat")}Ask RentCheck about this listing</button>
        ${aiReady ? `<button class="btn btn-ghost" type="button" id="aiBtn">AI second opinion</button>` : ""}
      </div><p class="form-note" id="aiNote" role="status"></p></section>
    <section class="block"><h3>Rent benchmark</h3>${benchmarkHTML(res, input)}</section>
    <section class="block"><h3>Warning signs <span class="count">${flags.length}</span></h3>${flagsHTML(flags, res.bench)}
      <p class="src"><span class="source-tag">${icon("doc")}RentCheck scam checks · Garda warning signs</span> Quotes are the exact words from the listing.</p></section>
    <p class="caveat">${icon("caution")}A clean result is not proof a listing is genuine. Always view the property in person before paying, check that the keys work, and pay traceably. If you have already been scammed, contact your bank and your local Garda station.</p>`;
  RC.countUp($("scoreNum"), score);
  requestAnimationFrame(() => { $("gaugeFill").style.width = Math.max(3, score) + "%"; });

  if (input.text) { $("marked").innerHTML = markListing(input.text, flags); $("markedWrap").hidden = false; $("text").parentElement.hidden = true; }
  else { $("markedWrap").hidden = true; $("text").parentElement.hidden = false; }

  body.querySelectorAll("blockquote[data-mark]").forEach(q => q.addEventListener("click", () => {
    const m = [...$("marked").querySelectorAll("mark")].find(x => x.dataset.nums.split(",").includes(String(+q.dataset.mark + 1)));
    if (m) { m.scrollIntoView({ block: "center", behavior: RC.reduced() ? "auto" : "smooth" }); m.classList.remove("pulse"); void m.offsetWidth; m.classList.add("pulse"); }
  }));
  $("toMap").addEventListener("click", () => {
    const patch = { beds: input.beds, type: input.kind === "room" ? "all" : input.kind };
    if (area) { const p = RC.PLACES[area]; Object.assign(patch, { area, pin: { lat: p.lat, lon: p.lon } }); }
    RC.set(patch, "checker"); RC.go("map");
  });
  $("toCopilot").addEventListener("click", () => RC.copilot.open());
  if (aiReady) $("aiBtn").addEventListener("click", secondOpinion);
}

function run(keepAi) {
  const input = readForm();
  if (!input.text && !input.price) { $("formNote").textContent = "Paste a listing, or enter a rent and an area."; return; }
  $("formNote").textContent = "";
  if (!keepAi || input.text !== lastText) aiFlags = [];
  lastText = input.text;
  const res = RC.assess(input);
  const extra = aiFlags.filter(f => input.text.includes(f.quote) && !res.flags.some(x => x.quote && x.quote.includes(f.quote)));
  const flags = [...res.flags, ...extra.map(f => ({ ...f, severity: "warning", ai: true }))];
  const score = Math.min(100, res.score + Math.min(20, extra.length * 8));
  const level = score >= 50 ? "high" : score >= 20 ? "caution" : "low";
  RC.set({ listing: { text: input.text, price: input.price, area: res.resolvedLocation || "", areaInput: input.location, beds: input.beds, kind: input.kind, score, level, flags, bench: res.bench } }, "checker");
  const panel = $("result"); panel.classList.add("busy");
  setTimeout(() => { panel.classList.remove("busy"); render(input, res, flags, score);
    if (matchMedia("(max-width: 900px)").matches) panel.scrollIntoView({ behavior: RC.reduced() ? "auto" : "smooth", block: "start" }); }, RC.reduced() ? 0 : 280);
}

async function secondOpinion() {
  const note = $("aiNote"), btn = $("aiBtn"), text = $("text").value.trim();
  btn.disabled = true; note.textContent = "Reading the listing…";
  try {
    const flags = await RC.ai.secondOpinion(text);
    aiFlags = flags.filter(f => f.quote && text.includes(f.quote));   // word-for-word quotes only
    run(true);
    $("aiNote").textContent = aiFlags.length ? `AI added ${aiFlags.length} observation${aiFlags.length > 1 ? "s" : ""}. Only quotes found word for word in the listing are shown.` : "AI found nothing beyond the checks above.";
  } catch (e) { note.textContent = "AI second opinion is unavailable right now. The checks above still apply."; btn.disabled = false; }
}

function reset() {
  ["text", "loc", "price"].forEach(id => { $(id).value = ""; }); $("beds").value = "2"; $("kind").value = "apt";
  $("markedWrap").hidden = true; $("text").parentElement.hidden = false; $("resultBody").hidden = true; $("resultEmpty").hidden = false; $("formNote").textContent = "";
  $("priceHint").textContent = "Optional"; $("locHint").textContent = "Town or Dublin area"; aiFlags = [];
  RC.set({ listing: null }, "checker");
}

document.querySelectorAll("[data-ex]").forEach(b => b.addEventListener("click", () => {
  const e = EX[b.dataset.ex]; $("text").value = e.text; $("loc").value = e.loc; $("price").value = (+e.price).toLocaleString("en-IE"); $("kind").value = e.kind; $("beds").value = e.beds; run();
}));
$("checkForm").addEventListener("submit", ev => { ev.preventDefault(); run(); });
$("clearBtn").addEventListener("click", reset);
$("editText").addEventListener("click", () => { $("markedWrap").hidden = true; $("text").parentElement.hidden = false; $("text").focus(); });
$("ctaCheck").addEventListener("click", () => { $("checker").scrollIntoView({ behavior: RC.reduced() ? "auto" : "smooth", block: "start" }); $("text").focus({ preventScroll: true }); });
$("copyAsk").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("askText").textContent); $("copyMsg").textContent = "Copied."; }
  catch (e) { const r = document.createRange(); r.selectNodeContents($("askText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("copyMsg").textContent = "Selected. Press Ctrl+C or ⌘C to copy."; }
});

RC.checker = { run, rerender: () => { if (RC.state.listing) run(true); },
  prefillArea: name => { $("loc").value = name; $("locHint").textContent = "From the map"; } };
})();
