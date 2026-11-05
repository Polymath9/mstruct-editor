import "./desktop-menu.css";

/** Menu hover/focus stays local; the adapter supplies data and validates commands. */
export function createDesktopMenu({ api, label }) {
  if (!api?.menuState) return null;
  const bar = document.createElement("nav");
  bar.className = "desktop-menu-bar"; bar.setAttribute("role", "menubar");
  const shell = document.querySelector(".editor-app"); shell.dataset.desktopMenu = "true"; shell.prepend(bar);
  let menus = [], openIndex = -1, previousFocus = null, revision = -1, destroyed = false;
  const focus = element => element?.focus({ preventScroll: true });
  function close(restore = true) {
    for (const menu of menus) { menu.panel.hidden = true; menu.button.setAttribute("aria-expanded", "false"); }
    openIndex = -1;
    for (const branch of bar.querySelectorAll("[data-open]")) delete branch.dataset.open;
    if (restore && previousFocus?.isConnected) focus(previousFocus);
  }
  function buttons(panel) { return [...panel.querySelectorAll(":scope > .desktop-menu-row > button:not(:disabled)")]; }
  function open(index, first = false) {
    if (!menus.length) return;
    if (openIndex < 0 && !bar.contains(document.activeElement)) previousFocus = document.activeElement;
    close(false); openIndex = (index + menus.length) % menus.length;
    const menu = menus[openIndex]; menu.panel.hidden = false; menu.button.setAttribute("aria-expanded", "true");
    focus(first ? buttons(menu.panel)[0] ?? menu.button : menu.button);
  }
  function panel(items, nested = false) {
    const list = document.createElement("div"); list.className = nested ? "desktop-menu-submenu" : "desktop-menu-panel"; list.setAttribute("role", "menu");
    for (const item of items) {
      const row = document.createElement("div");
      if (item.type === "separator") { row.className = "desktop-menu-separator"; row.setAttribute("role", "separator"); list.append(row); continue; }
      row.className = "desktop-menu-row"; row.setAttribute("role", "none");
      const button = document.createElement("button"), text = document.createElement("span");
      button.type = "button"; button.setAttribute("role", item.type === "radio" ? "menuitemradio" : "menuitem"); button.disabled = item.enabled === false; text.textContent = item.label; button.append(text); row.append(button);
      if (item.type === "radio") {
        button.setAttribute("aria-checked", String(item.checked));
        const check = document.createElement("span");
        check.textContent = item.checked ? "✓" : "";
        check.setAttribute("aria-hidden", "true");
        button.append(check);
      }
      if (item.submenu) {
        row.classList.add("desktop-menu-branch"); row.dataset.disabled = String(button.disabled);
        button.setAttribute("aria-haspopup", "menu");
        const arrow = document.createElement("span"); arrow.textContent = "›"; arrow.setAttribute("aria-hidden", "true"); button.append(arrow);
        const submenu = panel(item.submenu, true); row.append(submenu);
        button.addEventListener("click", () => { row.dataset.open = "true"; focus(buttons(submenu)[0]); });
      } else {
        if (item.accelerator) { const shortcut = document.createElement("kbd"); shortcut.textContent = item.accelerator.replace("CmdOrCtrl", "Ctrl").replace("Plus", "+"); button.append(shortcut); }
        button.addEventListener("click", () => { close(); void api.menuAction(item.id).catch(() => {}); });
      }
      list.append(row);
    }
    return list;
  }
  function update(state) {
    if (destroyed || !state || state.revision < revision) return;
    revision = state.revision; close(false); menus = []; bar.replaceChildren(); bar.setAttribute("aria-label", label());
    for (const [index, item] of state.menus.entries()) {
      const group = document.createElement("div"), button = document.createElement("button"), dropdown = panel(item.submenu ?? []);
      group.className = "desktop-menu-group"; button.className = "desktop-menu-top"; button.type = "button"; button.textContent = item.label;
      group.dataset.menuId = item.id;
      if (item.id === "language") {
        const globe = document.createElement("span");
        globe.textContent = "🌐︎";
        globe.setAttribute("aria-hidden", "true");
        button.replaceChildren(globe);
        button.classList.add("desktop-menu-language");
        button.setAttribute("aria-label", item.label);
        button.title = item.label;
      }
      button.dataset.menuId = item.id; button.setAttribute("role", "menuitem"); button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false"); dropdown.hidden = true;
      button.addEventListener("pointerdown", () => { if (!bar.contains(document.activeElement)) previousFocus = document.activeElement; });
      button.addEventListener("click", () => { if (openIndex === index) close(); else open(index); });
      button.addEventListener("pointerenter", () => { if (openIndex >= 0 && openIndex !== index) open(index); });
      group.append(button, dropdown); bar.append(group); menus.push({ button, panel: dropdown });
    }
  }
  function outside(event) { if (!bar.contains(event.target)) close(false); }
  function keydown(event) {
    if (!bar.contains(event.target)) return;
    const top = menus.findIndex(menu => menu.button === event.target), currentPanel = event.target.closest('[role="menu"]');
    const siblings = currentPanel ? buttons(currentPanel) : [], position = siblings.indexOf(event.target);
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "Tab") { close(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (top >= 0) { open(top, true); if (event.key === "ArrowUp" || event.key === "End") focus(buttons(menus[top].panel).at(-1)); }
      else if (siblings.length) focus(siblings[event.key === "Home" ? 0 : event.key === "End" ? siblings.length - 1 : (position + (event.key === "ArrowUp" ? -1 : 1) + siblings.length) % siblings.length]);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const branch = event.target.parentElement, child = branch.querySelector(":scope > .desktop-menu-submenu");
      if (event.key === "ArrowRight" && child) { branch.dataset.open = "true"; focus(buttons(child)[0]); }
      else if (event.key === "ArrowLeft" && currentPanel?.classList.contains("desktop-menu-submenu")) { const owner = currentPanel.parentElement; delete owner.dataset.open; focus(owner.querySelector("button")); }
      else if (openIndex >= 0) open(openIndex + (event.key === "ArrowLeft" ? -1 : 1), true);
      else focus(menus[(top + (event.key === "ArrowLeft" ? -1 : 1) + menus.length) % menus.length]?.button);
    }
  }
  document.addEventListener("pointerdown", outside); bar.addEventListener("keydown", keydown);
  const unsubscribe = api.onMenuChanged(update);
  const ready = api.menuState().then(update);
  return { ready, destroy() { destroyed = true; unsubscribe?.(); document.removeEventListener("pointerdown", outside); bar.remove(); delete shell.dataset.desktopMenu; } };
}
