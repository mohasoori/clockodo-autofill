// dialog.js — themed confirmation dialog (replaces window.confirm).
// confirmDialog({ title, message, confirmText, cancelText, danger, details }) → Promise<boolean>

export function confirmDialog({ title, message, confirmText = "Continue", cancelText = "Cancel", danger = false, details = [] } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "cd";

    const icon = document.createElement("div");
    icon.className = `cd-icon ${danger ? "danger" : ""}`;
    icon.innerHTML = danger
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 1.8 18.6A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>';

    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = message;

    const body = document.createElement("div");
    body.className = "cd-body";
    body.append(icon, h, p);
    if (details.length) {
      const ul = document.createElement("ul");
      ul.className = "cd-details";
      for (const d of details) { const li = document.createElement("li"); li.textContent = d; ul.appendChild(li); }
      body.appendChild(ul);
    }

    const actions = document.createElement("div");
    actions.className = "cd-actions";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.textContent = cancelText;
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = danger ? "danger-btn" : "primary"; ok.textContent = confirmText;
    actions.append(cancel, ok);

    dlg.append(body, actions);
    document.body.appendChild(dlg);

    const finish = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); }); // Esc
    dlg.addEventListener("click", (e) => { if (e.target === dlg) finish(false); }); // backdrop

    dlg.showModal();
    (danger ? cancel : ok).focus();
  });
}
