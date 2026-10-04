/* Front-end configuration. No secrets live here: the API key stays on the backend (see backend/config.py). */
window.RC = window.RC || {};
RC.config = {
  // Where the RentCheck backend lives. "" = same origin (python -m backend.app). When the page is opened straight
  // from disk there is no backend, and Copilot answers in its grounded, model-free mode.
  apiBase: location.protocol === "file:" ? null : "",
  defaults: { beds: "2", type: "apt", radius: 5 },
  budgetRange: [200, 20000],
};
