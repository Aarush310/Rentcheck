/* Shared UI helpers and the one piece of shared state that connects the listing check, the map and Copilot. */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- shared context ---- */
const state = { beds: RC.config.defaults.beds, type: RC.config.defaults.type, budget: null, radius: RC.config.defaults.radius,
  mode: "market", sort: "closest", area: null, pin: null, listing: null };
const subs = [];
function set(patch, source) {
  const changed = Object.keys(patch).filter(k => state[k] !== patch[k]);
  if (!changed.length) return;
  Object.assign(state, patch);
  subs.forEach(fn => fn(changed, source));
}
const on = fn => subs.push(fn);

/* The context Copilot receives: what the user has already told RentCheck. */
function context() {
  const c = { beds: state.beds, property_type: state.type, radius_km: state.radius };
  if (state.area) c.area = state.area;
  if (state.pin) c.pin = { lat: +state.pin.lat.toFixed(4), lon: +state.pin.lon.toFixed(4) };
  if (state.budget) c.budget_eur = state.budget;
  const l = state.listing;
  if (l) c.listing = { text: l.text, price_eur: l.price || null, area: l.area || "", beds: l.beds, kind: l.kind, score: l.score, level: l.level };
  return c;
}

const LEVELS = {
  high: { label: "High risk", icon: "high", cls: "high" },
  caution: { label: "Caution", icon: "caution", cls: "caution" },
  low: { label: "Low risk", icon: "low", cls: "low" },
};
const BUDGET = {
  within: { label: "Within budget", short: "Within", cls: "low", icon: "low" },
  close: { label: "Close to budget", short: "Close", cls: "caution", icon: "caution" },
  above: { label: "Above budget", short: "Above", cls: "high", icon: "high" },
};
const levelBadge = level => { const L = LEVELS[level]; return `<span class="badge ${L.cls}">${icon(L.icon)}${L.label}</span>`; };
const budgetBadge = (status, short) => { const B = BUDGET[status]; return `<span class="badge ${B.cls}">${icon(B.icon)}${short ? B.short : B.label}</span>`; };
const sourceTag = quarter => `<span class="source-tag">${icon("db")}RTB / CSO RIQ02${quarter ? " · " + esc(quarter) : ""}</span>`;
const kmText = d => (d < 1 ? "<1 km" : d.toFixed(1) + " km");
const shortName = n => String(n).split(",")[0];

function parseMoney(v) { const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : null; }

function countUp(el, to, ms = 700) {
  if (reduced()) { el.textContent = to; return; }
  const t0 = performance.now();
  setTimeout(() => { el.textContent = to; }, ms + 150);   // lands on the real score even if the tab is in the background
  (function tick(t) { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(tick); })(t0);
}
let toastTimer;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

function go(route) { if (location.hash !== "#/" + route) location.hash = "#/" + route; else RC.route && RC.route(); }

Object.assign(RC, { $, esc, icon, reduced, state, set, on, context, LEVELS, BUDGET, levelBadge, budgetBadge, sourceTag, kmText, shortName, parseMoney, countUp, toast, go });
})();
