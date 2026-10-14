/* global acquireVsCodeApi, document, window */
const vscode = acquireVsCodeApi();
const project = document.body.dataset.project;
const details = [...document.querySelectorAll("details[data-section]")];
const toggles = [...document.querySelectorAll("[data-bit-toggle]")];
const bitRows = [...document.querySelectorAll("tr[data-parent]")];
const values = [...document.querySelectorAll("[data-symbol]")];
const saved = vscode.getState();

function showBits(button, expanded) {
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "−" : "+";
  for (const row of bitRows)
    if (row.dataset.parent === button.dataset.bitToggle) row.hidden = !expanded;
}

function save() {
  vscode.setState({
    project,
    sections: Object.fromEntries(details.map((section) => [section.dataset.section, section.open])),
    bits: toggles
      .filter((button) => button.getAttribute("aria-expanded") === "true")
      .map((button) => button.dataset.bitToggle),
  });
}

if (saved?.project === project) {
  for (const section of details)
    if (typeof saved.sections?.[section.dataset.section] === "boolean")
      section.open = saved.sections[section.dataset.section];
  for (const button of toggles)
    showBits(button, saved.bits?.includes(button.dataset.bitToggle) ?? false);
}
for (const section of details) section.addEventListener("toggle", save);
for (const button of toggles)
  button.addEventListener("click", () => {
    showBits(button, button.getAttribute("aria-expanded") !== "true");
    save();
  });
for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", () => vscode.postMessage({ action: button.dataset.action }));

window.addEventListener("message", ({ data }) => {
  if (data.action !== "samples") return;
  document.getElementById("connection-status").textContent = data.connection;
  const samples = new Map(data.samples.map((sample) => [sample.symbol, sample]));
  for (const element of values) {
    const sample = samples.get(element.dataset.symbol);
    element.textContent = sample?.text ?? "—";
    element.title = sample?.title ?? "No sample received";
    element.className = sample?.state ?? "muted";
  }
});
vscode.postMessage({ action: "ready" });
