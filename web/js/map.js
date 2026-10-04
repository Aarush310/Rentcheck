/* Rent intelligence map: county choropleth + area dots (approximate centres), market and affordability modes,
   area detail and nearby alternatives. All figures come from RC.rentFor / RC.nearby (RTB data). */
(function () {
"use strict";
const { $, esc, icon, eur, qlabel, state } = RC;
const svg = $("map"), stage = $("mapStage"), tip = $("tip"), NS = "http://www.w3.org/2000/svg";

// Simple equirectangular projection tuned for Ireland (same as the original prototype).
const LON0 = -10.7, LAT0 = 55.45, KY = 170, KX = 170 * Math.cos(53.4 * Math.PI / 180), KM = KY / 111;
const proj = (lon, lat) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
const unproj = (x, y) => ({ lon: x / KX + LON0, lat: LAT0 - y / KY });
const PRESETS = { Ireland: null, Dublin: { lon: -6.26, lat: 53.345, span: 0.42 }, Cork: { lon: -8.47, lat: 51.895, span: 0.35 },
  Galway: { lon: -9.04, lat: 53.275, span: 0.3 }, Limerick: { lon: -8.63, lat: 52.655, span: 0.3 }, Waterford: { lon: -7.11, lat: 52.25, span: 0.3 } };
const RAMP_LIGHT = ["#DCEFE4", "#9DD3BF", "#4FAAA5", "#2C7B99", "#28508A", "#221E5A"];
const RAMP_DARK = ["#22375A", "#2A6488", "#3A9A9C", "#7CCBAE", "#C9E8A6", "#F4F3B4"];
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const ramp = () => (dark() ? RAMP_DARK : RAMP_LIGHT);
function rampColor(t) {
  const R = ramp(); t = Math.max(0, Math.min(1, t)); const i = Math.min(R.length - 2, Math.floor(t * (R.length - 1))), f = t * (R.length - 1) - i;
  const a = R[i].match(/\w\w/g).map(h => parseInt(h, 16)), b = R[i + 1].match(/\w\w/g).map(h => parseInt(h, 16));
  return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
}
const STATUS_FILL = { within: "var(--st-within)", close: "var(--st-close)", above: "var(--st-above)" };

const AREAS = RC.PLACE_NAMES.filter(n => RC.PLACES[n].p !== "county").map(n => { const p = RC.PLACES[n], [x, y] = proj(p.lon, p.lat); return { n, p, x, y, el: null, r: null }; });
const byName = Object.fromEntries(AREAS.map(a => [a.n, a]));
let view = null, W = 0, H = 0, anim = 0, built = false, showAll = false;
const g = {};

function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

function build() {
  built = true;
  ["counties", "radius", "dots", "sel", "labels", "pin"].forEach(k => { g[k] = el("g", { class: "g-" + k }, svg); });
  g.countyEls = Object.entries(RC.COUNTIES).map(([name, c]) => {
    const d = c.rings.map(r => "M" + r.map(([lon, lat]) => proj(lon, lat).map(v => v.toFixed(1)).join(",")).join("L") + "Z").join("");
    return { name, el: el("path", { d, class: "county", "data-c": name }, g.counties) };
  });
  g.radiusEl = el("circle", { class: "radius", r: 0 }, g.radius);
  AREAS.forEach(a => { a.el = el("circle", { class: "dot", cx: a.x.toFixed(2), cy: a.y.toFixed(2), "data-n": a.n }, g.dots); });
  g.selEl = el("circle", { class: "sel-ring", r: 0 }, g.sel);
  g.pinEl = el("path", { class: "pin", d: "M0,0 l-7,-16 a8,8 0 1 1 14,0 z" }, g.pin);
  Object.keys(PRESETS).forEach(n => { const b = document.createElement("button"); b.type = "button"; b.textContent = n; b.addEventListener("click", () => preset(n)); $("presets").appendChild(b); });
}

/* ---------- view ---------- */
function measure() { const r = stage.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); }
function fitIreland() { const [cx, cy] = proj(-8.05, 53.45); return { cx, cy, w: Math.max(486 * 1.04, 600 * 1.06 * W / H) }; }
function apply() {
  const h = view.w * H / W, s = view.w / W;
  svg.setAttribute("viewBox", `${view.cx - view.w / 2} ${view.cy - h / 2} ${view.w} ${h}`);
  svg.classList.toggle("zoomed", s < 0.4);
  const zoomBoost = s < 0.12 ? 1.5 : s < 0.3 ? 1.2 : 1;
  for (const a of AREAS) a.el.setAttribute("r", ((a.r ? 4.2 : 2.4) * zoomBoost * s).toFixed(4));
  const sel = state.area && byName[state.area];
  if (sel) { g.selEl.setAttribute("cx", sel.x); g.selEl.setAttribute("cy", sel.y); g.selEl.setAttribute("r", (9.5 * zoomBoost * s).toFixed(4)); g.selEl.style.display = ""; } else g.selEl.style.display = "none";
  if (state.pin) {
    const [x, y] = proj(state.pin.lon, state.pin.lat);
    g.radiusEl.setAttribute("cx", x); g.radiusEl.setAttribute("cy", y); g.radiusEl.setAttribute("r", state.radius * KM); g.radiusEl.style.display = "";
    g.pinEl.setAttribute("transform", `translate(${x},${y}) scale(${s})`); g.pinEl.style.display = sel ? "none" : "";
  } else { g.radiusEl.style.display = "none"; g.pinEl.style.display = "none"; }
}
function clampView(v) { const max = fitIreland().w * 1.25; return { cx: Math.max(-40, Math.min(526, v.cx)), cy: Math.max(-40, Math.min(640, v.cy)), w: Math.max(4, Math.min(max, v.w)) }; }
function flyTo(target, ms = 520) {
  cancelAnimationFrame(anim); target = clampView(target);
  if (RC.reduced() || !view) { view = target; apply(); labels(); return; }
  const from = { ...view }, t0 = performance.now(); g.labels.textContent = "";
  (function tick(t) {
    const p = Math.min(1, (t - t0) / ms), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    view = { cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, w: Math.exp(Math.log(from.w) + (Math.log(target.w) - Math.log(from.w)) * e) };
    apply(); if (p < 1) anim = requestAnimationFrame(tick); else labels();
  })(t0);
}
function preset(n) { const v = PRESETS[n]; if (!v) return flyTo(fitIreland()); const [cx, cy] = proj(v.lon, v.lat); flyTo({ cx, cy, w: v.span * KX * Math.max(1, W / H * 0.9) }); }
function focusWidth() { return Math.max(14, state.radius * 2 * KM * 1.5) * Math.max(1, W / H); }
function focus(pt) { const [cx, cy] = proj(pt.lon, pt.lat); flyTo({ cx, cy, w: focusWidth() }); }
function zoomBy(f, at) {
  cancelAnimationFrame(anim);
  const h = view.w * H / W, ax = at ? at.x : view.cx, ay = at ? at.y : view.cy, nw = clampView({ ...view, w: view.w * f }).w, k = nw / view.w;
  const target = { cx: ax + (view.cx - ax) * k, cy: ay + (view.cy - ay) * k, w: nw };
  if (at) { view = clampView(target); apply(); clearTimeout(zoomBy.t); zoomBy.t = setTimeout(labels, 140); } else flyTo(target, 260);
  void h;
}
function svgPoint(ev) { const r = svg.getBoundingClientRect(), h = view.w * H / W; return { x: view.cx - view.w / 2 + (ev.clientX - r.left) / r.width * view.w, y: view.cy - h / 2 + (ev.clientY - r.top) / r.height * h }; }

/* ---------- colour ---------- */
function paint() {
  const { beds, type, budget } = state, afford = state.mode === "afford" && budget;
  let vals = [];
  for (const a of AREAS) { a.r = RC.rentFor(a.n, beds, type); if (a.r) vals.push(a.r.value); }
  vals.sort((x, y) => x - y);
  const lo = vals[Math.floor(vals.length * 0.05)] || 0, hi = vals[Math.floor(vals.length * 0.95)] || 1;
  const col = v => (afford ? STATUS_FILL[RC.budgetStatus(v, budget)] : rampColor((v - lo) / Math.max(1, hi - lo)));
  const counts = { within: 0, close: 0, above: 0 };
  for (const a of AREAS) {
    a.el.classList.toggle("nodata", !a.r); a.el.style.fill = a.r ? col(a.r.value) : "";
    if (a.r && budget) counts[RC.budgetStatus(a.r.value, budget)]++;
  }
  for (const a of AREAS) if (a.r) g.dots.appendChild(a.el);   // areas with a figure draw above those without
  for (const c of g.countyEls) { const r = RC.rentFor(c.name, beds, type); c.r = r; c.el.style.fill = r ? col(r.value) : ""; c.el.classList.toggle("nodata", !r); }
  svg.classList.toggle("afford", !!afford);
  legend(lo, hi, vals.length, counts, afford);
  $("mapSub").innerHTML = `RTB average rent, <b>${esc(RC.describe(beds, type))}</b> · ${esc(RC.latestLabel())} snapshot · agreed rents in new tenancies, not asking prices`;
  if (view) { apply(); labels(); }
}
function legend(lo, hi, n, counts, afford) {
  const L = $("legend"), desc = esc(RC.describe(state.beds, state.type));
  const foot = `<div class="lg-foot"><span><i class="sw nodata"></i>No RTB figure</span><span>Dots mark approximate area centres</span></div>`;
  if (state.mode === "afford" && !state.budget) { L.innerHTML = `<div class="lg-title">Where can I afford to live?</div><p class="lg-prompt">Enter a monthly budget above to colour each area by whether its RTB average fits.</p>${foot}`; return; }
  if (afford) {
    L.innerHTML = `<div class="lg-title">${desc} vs ${eur(state.budget)} budget</div>
      <div class="lg-status"><span><i class="sw within"></i>Within budget <b>${counts.within}</b></span><span><i class="sw close"></i>Close, up to 10% over <b>${counts.close}</b></span><span><i class="sw above"></i>Above budget <b>${counts.above}</b></span></div>${foot}`;
    return;
  }
  L.innerHTML = `<div class="lg-title">RTB average rent · ${desc}</div>
    <div class="lg-ramp"><span>${eur(lo)}</span><i style="background:linear-gradient(90deg,${ramp().join(",")})"></i><span>${eur(hi)}+</span></div>
    <div class="lg-foot"><span>${n} areas · counties shaded by county average</span></div>${foot}`;
}

/* ---------- labels (only when zoomed in) ---------- */
function labels() {
  g.labels.textContent = "";
  const s = view.w / W; if (s > 0.2) return;
  const h = view.w * H / W, x0 = view.cx - view.w / 2, y0 = view.cy - h / 2, pin = state.pin;
  const cand = AREAS.filter(a => a.r && a.x > x0 && a.x < x0 + view.w && a.y > y0 && a.y < y0 + h)
    .map(a => ({ a, d: pin ? RC.km(pin, a.p) : 0 })).sort((p, q) => (q.a.n === state.area) - (p.a.n === state.area) || p.d - q.d).slice(0, 80);
  const placed = [];
  for (const { a } of cand) {
    const name = RC.shortName(a.n), rent = eur(a.r.value), wpx = (name.length + rent.length + 1) * 6.3 + 12, px = (a.x - x0) / s + 9, py = (a.y - y0) / s;
    if (px + wpx > W - 4 || placed.some(b => Math.abs(b.y - py) < 15 && px < b.x + b.w && b.x < px + wpx)) continue;
    placed.push({ x: px, y: py, w: wpx });
    const t = el("text", { x: (a.x + 9 * s).toFixed(3), y: (a.y + 4 * s).toFixed(3), "font-size": (11.5 * s).toFixed(4), "stroke-width": (3.2 * s).toFixed(4), class: "lbl" + (a.n === state.area ? " on" : "") }, g.labels);
    t.innerHTML = `${esc(name)} <tspan>${rent}</tspan>`;
    if (placed.length >= 36) break;
  }
}

/* ---------- pointer: pan, zoom, select, pin ---------- */
let drag = null;
svg.addEventListener("pointerdown", ev => { if (ev.button) return; drag = { x: ev.clientX, y: ev.clientY, moved: false, target: ev.target, cx: view.cx, cy: view.cy }; svg.setPointerCapture(ev.pointerId); });
svg.addEventListener("pointermove", ev => {
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; cancelAnimationFrame(anim); svg.classList.add("panning"); tip.hidden = true; }
    if (drag.moved) { const s = view.w / W; view = clampView({ cx: drag.cx - dx * s, cy: drag.cy - dy * s, w: view.w }); apply(); }
    return;
  }
  hover(ev);
});
svg.addEventListener("pointerup", ev => {
  if (!drag) return; const d = drag; drag = null; svg.classList.remove("panning");
  if (d.moved) { labels(); return; }
  const dot = d.target.closest && d.target.closest(".dot");
  if (dot) return select(dot.dataset.n);
  const p = svgPoint(ev), geo = unproj(p.x, p.y);
  if (geo.lat < 51.2 || geo.lat > 55.6 || geo.lon < -10.9 || geo.lon > -5.2) return;
  RC.set({ area: null, pin: geo }, "map");
});
svg.addEventListener("pointerleave", () => { tip.hidden = true; });
svg.addEventListener("wheel", ev => { ev.preventDefault(); zoomBy(Math.exp(Math.max(-60, Math.min(60, ev.deltaY)) * 0.0045), svgPoint(ev)); }, { passive: false });
$("zIn").addEventListener("click", () => zoomBy(0.55)); $("zOut").addEventListener("click", () => zoomBy(1.8)); $("zReset").addEventListener("click", () => flyTo(fitIreland()));

function hover(ev) {
  const t = ev.target, dot = t.closest(".dot"), county = t.closest(".county");
  let html = "";
  if (dot) {
    const a = byName[dot.dataset.n];
    html = `<b>${esc(a.n)}</b>` + (a.r ? `<span class="tip-v">${eur(a.r.value)} <small>/ month</small></span><span>${esc(RC.describe(state.beds, state.type))} · RTB ${qlabel(a.r.q)}</span>${state.budget ? RC.budgetBadge(RC.budgetStatus(a.r.value, state.budget)) : ""}`
      : `<span>No RTB figure for a ${esc(RC.describe(state.beds, state.type))}</span>`);
    const same = AREAS.filter(b => b !== a && b.r && Math.abs(b.x - a.x) < 0.01 && Math.abs(b.y - a.y) < 0.01);   // several areas can share one approximate centre
    if (same.length) html += `<span class="tip-same">Same approximate position: ${same.slice(0, 4).map(b => `${esc(RC.shortName(b.n))} ${eur(b.r.value)}`).join(", ")}</span>`;
  } else if (county) {
    const c = g.countyEls.find(x => x.name === county.dataset.c);
    html = `<b>Co. ${esc(c.name)}</b>` + (c.r ? `<span class="tip-v">${eur(c.r.value)} <small>county average</small></span><span>RTB ${qlabel(c.r.q)}</span>` : `<span>No county figure</span>`);
  }
  if (!html) { tip.hidden = true; return; }
  const r = stage.getBoundingClientRect(); tip.innerHTML = html; tip.hidden = false;
  const tw = tip.offsetWidth, x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
  tip.style.left = Math.min(x, r.width - tw - 8) + "px"; tip.style.top = Math.min(y, r.height - tip.offsetHeight - 8) + "px";
}

function select(name) { const p = RC.PLACES[name]; if (!p) return; RC.set({ area: name, pin: { lat: p.lat, lon: p.lon } }, "map"); }

/* ---------- side panel ---------- */
function nearbyRows() {
  if (!state.pin) return { rows: [], missing: 0 };
  const all = RC.nearby(state.pin, state.radius, state.beds, state.type).filter(x => x.name !== state.area);
  const rows = all.filter(x => x.r).map(x => ({ name: x.name, d: x.d, rent: x.r.value, q: x.r.q, status: state.budget ? RC.budgetStatus(x.r.value, state.budget) : null }));
  const order = { within: 0, close: 1, above: 2 };
  if (state.sort === "cheapest") rows.sort((a, b) => a.rent - b.rent || a.d - b.d);
  else if (state.sort === "fit" && state.budget) rows.sort((a, b) => order[a.status] - order[b.status] || (a.status === "within" ? a.d - b.d : a.rent - b.rent));
  return { rows, missing: all.length - rows.length };
}
function insight(sel, rows) {
  const b = state.budget; if (!b) return "";
  const desc = RC.describe(state.beds, state.type); let text;
  if (!state.pin) {
    const all = AREAS.filter(a => a.r), k = all.filter(a => a.r.value <= b).length;
    text = `<b>${k} of ${all.length}</b> areas with a ${esc(desc)} figure have an RTB average within ${eur(b)}. Select an area to see nearby alternatives.`;
  } else {
    const within = rows.filter(r => r.status === "within").sort((x, y) => x.d - y.d), best = within[0];
    const alt = rows.length ? (best ? `<b>${within.length} of ${rows.length}</b> nearby areas within ${state.radius} km are within budget; the nearest is <button class="link" data-area="${esc(best.name)}">${esc(RC.shortName(best.name))}</button> at ${eur(best.rent)}, ${RC.kmText(best.d)} away.`
      : `No area within ${state.radius} km has an RTB average within budget for a ${esc(desc)}. Try a wider radius or a smaller home.`) : "";
    if (sel && sel.r) {
      const st = RC.budgetStatus(sel.r.value, b), over = sel.r.value - b, name = esc(RC.shortName(sel.n));
      text = st === "above" ? `With a ${eur(b)} monthly budget, ${name} is <b>above your target</b> (RTB average ${eur(sel.r.value)}, ${eur(over)} over). ${alt || "Nearby areas may offer better value."}`
        : st === "close" ? `With a ${eur(b)} monthly budget, ${name} is <b>close to your target</b> (RTB average ${eur(sel.r.value)}, ${eur(over)} over). ${alt}`
        : `With a ${eur(b)} monthly budget, ${name} is <b>within your target</b> (RTB average ${eur(sel.r.value)}, ${eur(-over)} under). Asking prices usually sit above RTB averages, so leave headroom.`;
    } else text = alt || `No RTB figures for a ${esc(desc)} near this point.`;
  }
  return `<div class="insight">${icon("pin")}<p>${text}</p>${state.pin ? `<button class="btn btn-secondary btn-sm" type="button" id="askWhere">${icon("chat")}Ask RentCheck where to look</button>` : ""}</div>`;
}
function matrix(name) {
  const types = [["all", "Any"], ["apt", "Apartment"], ["house", "House"]], beds = ["all", "1", "2", "3", "4"];
  return `<table class="matrix"><thead><tr><th></th>${types.map(t => `<th>${t[1]}</th>`).join("")}</tr></thead><tbody>` + beds.map(b => `<tr><th>${b === "all" ? "All sizes" : RC.BEDS[b]}</th>` + types.map(([t]) => {
    const r = RC.rentFor(name, b, t), on = b === state.beds && t === state.type;
    return `<td class="${on ? "on" : ""}${r ? "" : " na"}"${r ? ` title="RTB ${qlabel(r.q)}"` : ' title="Withheld or not published"'}>${r ? `<button type="button" data-beds="${b}" data-type="${t}">${eur(r.value)}</button>` : "—"}</td>`;
  }).join("") + "</tr>").join("") + `</tbody></table>`;
}
function detail(sel, rows) {
  const desc = RC.describe(state.beds, state.type);
  if (!state.pin) {
    const low = AREAS.filter(a => a.r).sort((a, b) => a.r.value - b.r.value).slice(0, 6);
    return `<div class="detail"><span class="k">Explore</span><h3>Select an area</h3><p class="muted">Click a dot, search for an area, or click anywhere on the map to drop a pin and see RTB averages nearby.</p>
      <h4>Lowest RTB averages · ${esc(desc)}</h4><ul class="near-list">${low.map(a => rowHTML({ name: a.n, rent: a.r.value, q: a.r.q, status: state.budget ? RC.budgetStatus(a.r.value, state.budget) : null })).join("") || `<li class="muted">No figures for this size and type.</li>`}</ul></div>`;
  }
  const selRent = state.area && byName[state.area] && byName[state.area].r, all = rows.map(r => r.rent).concat(selRent ? [selRent.value] : []);
  const med = RC.median(all);   // same definition as the rents_near tool: every area with a figure inside the radius
  if (!sel) {
    return `<div class="detail"><div class="detail-head"><div><span class="k">Pinned location</span><h3>Around your pin</h3></div><button class="icon-btn" type="button" id="clearSel" aria-label="Clear pin">${icon("x")}</button></div>
      ${med != null ? `<div class="detail-fig"><span class="v">${eur(med)}</span><span class="u">/ month</span></div><p class="detail-meta">Median RTB average, ${esc(desc)}, across ${rows.length} area${rows.length > 1 ? "s" : ""} within ${state.radius} km</p>`
        : `<p class="notice">${icon("caution")}No RTB figures for a ${esc(desc)} within ${state.radius} km. Widen the radius or change the size.</p>`}
      <div class="actions"><button class="btn btn-secondary btn-sm" type="button" id="askArea">${icon("chat")}Ask RentCheck about here</button></div></div>`;
  }
  const [town, ...rest] = sel.n.split(","), r = sel.r;
  let fig, cmp = "";
  if (r) {
    const st = state.budget ? RC.budgetStatus(r.value, state.budget) : null, over = state.budget ? r.value - state.budget : 0;
    fig = `<div class="detail-fig"><span class="v">${eur(r.value)}</span><span class="u">/ month</span>${st ? RC.budgetBadge(st) : ""}</div>
      <p class="detail-meta">${esc(desc)} · RTB average · ${qlabel(r.q)}${st ? ` · ${over > 0 ? eur(over) + " over" : eur(-over) + " under"} budget` : ""}</p>`;
    if (med != null && rows.length > 0) {
      const lo = Math.min(r.value, ...rows.map(x => x.rent)), hi = Math.max(r.value, ...rows.map(x => x.rent)), pos = v => ((v - lo) / Math.max(1, hi - lo) * 100).toFixed(1), d = r.value - Math.round(med);
      cmp = `<h4>Compared with nearby areas</h4><div class="rangeviz" role="img" aria-label="${esc(town)} ${eur(r.value)}; nearby range ${eur(lo)} to ${eur(hi)}, median ${eur(med)}">
        <div class="rv-track">${state.budget && state.budget >= lo && state.budget <= hi ? `<i class="rv-budget" style="left:${pos(state.budget)}%" title="Your budget"></i>` : ""}<i class="rv-med" style="left:${pos(med)}%"></i><i class="rv-sel" style="left:${pos(r.value)}%"></i></div>
        <div class="rv-scale"><span>${eur(lo)}</span><span>median ${eur(med)}</span><span>${eur(hi)}</span></div></div>
        <p class="muted">${d === 0 ? "In line with" : eur(Math.abs(d)) + (d < 0 ? " below" : " above")} the median of ${all.length} areas within ${state.radius} km.</p>`;
    }
  } else fig = `<p class="notice">${icon("caution")}The RTB has no ${esc(desc)} figure for ${esc(town)} (small samples are withheld). Pick another size or type below.</p>`;
  return `<div class="detail"><div class="detail-head"><div><span class="k">Selected area</span><h3>${esc(town)}${rest.length ? ` <small>${esc(rest.join(",").trim())}</small>` : ""}</h3></div><button class="icon-btn" type="button" id="clearSel" aria-label="Clear selection">${icon("x")}</button></div>
    ${fig}${cmp}<h4>Available RTB data</h4>${matrix(sel.n)}
    <div class="actions"><button class="btn btn-primary btn-sm" type="button" id="askArea">${icon("chat")}Ask RentCheck about this area</button><button class="btn btn-secondary btn-sm" type="button" id="useArea">Check a listing here</button></div></div>`;
}
function rowHTML(r) {
  return `<li><button type="button" class="near-row" data-area="${esc(r.name)}"><span class="nr-name">${esc(RC.shortName(r.name))}<small>${r.d != null ? RC.kmText(r.d) + " · " : ""}${qlabel(r.q)}</small></span>
    <span class="nr-rent">${eur(r.rent)}</span>${r.status ? RC.budgetBadge(r.status, true) : ""}</button></li>`;
}
function nearList(rows, missing) {
  if (!state.pin) return "";
  const sorts = [["closest", "Closest"], ["cheapest", "Cheapest"], ["fit", "Best fit"]], shown = showAll ? rows : rows.slice(0, 8);
  return `<div class="near"><div class="near-head"><h4>Nearby areas <small>within ${state.radius} km</small></h4>
      <div class="seg seg-sm" role="radiogroup" aria-label="Sort nearby areas">${sorts.map(([k, l]) => `<button type="button" role="radio" data-sort="${k}" aria-checked="${state.sort === k}"${k === "fit" && !state.budget ? ' disabled title="Enter a budget to sort by best fit"' : ""}>${l}</button>`).join("")}</div></div>
    ${rows.length ? `<ul class="near-list">${shown.map(rowHTML).join("")}</ul>` : `<p class="muted">No other RTB areas with a figure within ${state.radius} km. Widen the radius.</p>`}
    ${rows.length > shown.length ? `<button class="link" type="button" id="showAll">Show all ${rows.length}</button>` : ""}
    ${missing ? `<p class="muted small">${missing} more area${missing > 1 ? "s" : ""} nearby with no RTB figure for this size and type.</p>` : ""}
    <p class="src">${RC.sourceTag(RC.latestLabel())} Average rents agreed in newly registered tenancies, not asking prices. Distances are between approximate area centres.</p></div>`;
}
function side() {
  const sel = state.area ? byName[state.area] : null, { rows, missing } = nearbyRows(), box = $("mapSide");
  box.innerHTML = insight(sel, rows) + detail(sel, rows) + nearList(rows, missing);
  box.querySelectorAll("[data-area]").forEach(b => b.addEventListener("click", () => select(b.dataset.area)));
  box.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => RC.set({ sort: b.dataset.sort }, "map")));
  box.querySelectorAll(".matrix button").forEach(b => b.addEventListener("click", () => RC.set({ beds: b.dataset.beds, type: b.dataset.type }, "map")));
  const bind = (id, fn) => { const e = $(id); if (e) e.addEventListener("click", fn); };
  bind("clearSel", () => RC.set({ area: null, pin: null }, "map"));
  bind("showAll", () => { showAll = true; side(); });
  bind("askArea", () => RC.copilot.open());
  bind("askWhere", () => RC.copilot.ask(state.area ? "Where should I look instead?" : "Where should I look near my pin?"));
  bind("useArea", () => { RC.checker.prefillArea(state.area); RC.go("check"); $("checker").scrollIntoView({ block: "start" }); });
}

/* ---------- toolbar <-> state ---------- */
function syncControls() {
  $("mBeds").value = state.beds; $("mType").value = state.type; $("radius").value = state.radius; $("radiusOut").textContent = state.radius + " km";
  if (document.activeElement !== $("mBudget")) $("mBudget").value = state.budget ? state.budget.toLocaleString("en-IE") : "";
  document.querySelectorAll("#modeSeg button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.mode === state.mode)));
}
$("mBeds").addEventListener("change", e => RC.set({ beds: e.target.value }, "map"));
$("mType").addEventListener("change", e => RC.set({ type: e.target.value }, "map"));
$("radius").addEventListener("input", e => RC.set({ radius: +e.target.value }, "map"));
$("mBudget").addEventListener("input", e => {
  const v = RC.parseMoney(e.target.value), [min, max] = RC.config.budgetRange, ok = v && v >= min && v <= max;
  e.target.parentElement.classList.toggle("invalid", !!e.target.value.trim() && !ok);
  RC.set(ok ? { budget: Math.round(v), mode: "afford" } : { budget: null, sort: state.sort === "fit" ? "closest" : state.sort }, "map");
});
$("mBudget").addEventListener("blur", syncControls);
document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => { RC.set({ mode: b.dataset.mode }, "map"); if (b.dataset.mode === "afford" && !state.budget) $("mBudget").focus(); }));
$("mSearch").addEventListener("change", e => {
  const n = RC.resolve(e.target.value), wrap = e.target;
  if (!e.target.value.trim()) return;
  if (!n) { wrap.classList.add("invalid"); RC.toast(`No RTB area matches “${e.target.value}”.`); return; }
  wrap.classList.remove("invalid"); e.target.value = "";
  if (RC.PLACES[n].p === "county") { const c = RC.COUNTIES[n].c, [cx, cy] = proj(c[0], c[1]); RC.toast(`${n} is a county: showing its areas.`); return flyTo({ cx, cy, w: 150 }); }
  select(n);
});

RC.on((changed) => {
  if (!built || $("view-map").hidden) return;
  syncControls();
  if (changed.some(k => ["beds", "type", "budget", "mode"].includes(k))) paint();
  if (changed.includes("area") || changed.includes("pin")) { showAll = false; if (state.pin) focus(state.pin); else { apply(); labels(); } }
  else if (changed.includes("radius")) { if (state.pin) focus(state.pin); }
  side();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => built && paint());
new ResizeObserver(() => { if (!built || $("view-map").hidden) return; const oldW = W; measure(); if (!oldW || !view) view = fitIreland(); else view = clampView({ ...view, w: view.w * W / oldW });   // keep the same scale
  apply(); labels(); }).observe(stage);

RC.map = {
  show() {
    if (!built) build();
    measure(); syncControls(); paint();
    if (!view) { view = fitIreland(); apply(); if (state.pin) focus(state.pin); } else if (state.pin) focus(state.pin); else { apply(); labels(); }
    side();
  },
  select, refresh() { if (built && !$("view-map").hidden) { paint(); side(); } },
};
})();
