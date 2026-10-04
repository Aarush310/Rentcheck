/* App shell: routing between the checker and the map, the data/system dialog, and loading a newer RTB file. */
(function () {
"use strict";
const { $, esc } = RC;

function route() {
  const name = location.hash.replace(/^#\/?/, "") === "map" ? "map" : "check";
  $("view-check").hidden = name !== "check"; $("view-map").hidden = name !== "map";
  document.body.dataset.route = name;
  document.querySelectorAll("[data-route]").forEach(a => a.toggleAttribute("aria-current", a.dataset.route === name));
  if (name === "map") { window.scrollTo(0, 0); RC.map.show(); }
}
RC.route = route;
addEventListener("hashchange", route);

/* ---- data + system status ---- */
function setStatus() {
  const q = RC.latestLabel(), st = RC.ai.status, n = Object.keys(RC.store.rents).length;
  $("dataChipText").textContent = `RTB / CSO RIQ02 · ${q}`; $("proofQuarter").textContent = q;
  const row = (k, ok, v) => `<div><dt>${k}</dt><dd><span class="dot-s ${ok}"></span>${v}</dd></div>`;
  $("sysStatus").innerHTML =
    row("Rent data", "ok", `RTB / CSO RIQ02 to <b>${esc(q)}</b> · ${n} areas · ${esc(RC.store.label)} (stored snapshot, not live)`) +
    row("Scam checks", "ok", `${RC.RULES.length} deterministic rules based on Garda warning signs, plus a price check against the RTB average`) +
    row("MCP server", st.mcp ? "ok" : "off", st.mcp ? `Connected · ${st.mcp_tools.length} tools: ${st.mcp_tools.map(esc).join(", ")}` : esc(st.mcp_reason || (st.backend ? "Not connected." : "Not running: start the backend with python -m backend.app.")) + " The same tools run in the browser.") +
    row("Language model", st.ai ? "ok" : "off", st.ai ? `${esc(st.model)} via the OpenAI Agents SDK, calling the MCP tools for every figure` : esc(st.ai_reason || "Not configured.") + " Copilot answers in grounded mode: straight from tool results, no model.");
}
RC.openSources = () => { setStatus(); const d = $("sourcesDlg"); if (!d.open) d.showModal(); };
$("dataChip").addEventListener("click", RC.openSources); $("footSources").addEventListener("click", RC.openSources);
$("srcClose").addEventListener("click", () => $("sourcesDlg").close());
$("sourcesDlg").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

function loadFile(f) {
  const msg = $("loadMsg"); msg.className = "form-note"; msg.textContent = `Reading ${f.name}…`;
  f.text().then(t => {
    try {
      const d = RC.ingestRIQ02(t);
      if (d.latest < RC.store.latest) { msg.textContent = `That file only goes to ${RC.qlabel(d.latest)}, older than the current data (${RC.latestLabel()}). Keeping the current data.`; return; }
      RC.useData(d, f.name);
      const unmapped = Object.keys(d.rents).filter(n => !RC.PLACES[n]).length;
      msg.textContent = `Loaded ${Object.keys(d.rents).length} areas up to ${RC.qlabel(d.latest)} in this browser.` + (unmapped ? ` ${unmapped} new area names have no map position yet.` : "") + " Copilot's AI mode keeps using the server's snapshot until you run update_data.py.";
      setStatus(); RC.map.refresh(); RC.checker.rerender();
    } catch (e) { msg.className = "form-note err"; msg.textContent = e.message; }
  }).catch(() => { msg.className = "form-note err"; msg.textContent = "Couldn't read that file."; });
}
$("file").addEventListener("change", e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
const drop = $("drop");
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

setStatus(); route();
RC.ai.init().then(() => { setStatus(); RC.copilot.refresh(); });
})();
