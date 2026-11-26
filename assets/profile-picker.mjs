import { icon } from "./icons.mjs";

function appendMatch(parent, label, query) {
  const at = query ? label.toLocaleLowerCase().indexOf(query) : -1;
  if (at < 0) {
    parent.append(label);
    return;
  }
  const strong = document.createElement("strong");
  strong.textContent = label.slice(at, at + query.length);
  parent.append(label.slice(0, at), strong);
  appendMatch(parent, label.slice(at + query.length), query);
}

export function profilePicker(pane, index, profiles, onError) {
  const root = document.createElement("div");
  root.className = "pane-profile";
  const listId = "profile-results-" + (index + 1);
  root.innerHTML = `
    <input type="text" role="combobox" autocomplete="off" spellcheck="false"
      aria-label="Buscar modelo para la vista ${index + 1}" aria-controls="${listId}"
      aria-expanded="false" aria-autocomplete="list" placeholder="Buscar modelo">
    <button type="button" class="profile-clear" title="Limpiar búsqueda" aria-label="Limpiar búsqueda">${icon("cross")}</button>
    <div class="profile-popup" popover="manual">
      <ul id="${listId}" role="listbox" aria-label="Modelos disponibles"></ul>
      <div class="profile-empty" role="status" hidden>Sin coincidencias</div>
    </div>`;
  pane.root.querySelector(".selected").append(root);
  const input = root.querySelector("input");
  const clear = root.querySelector("button");
  const popup = root.querySelector(".profile-popup");
  const list = popup.querySelector("ul");
  const empty = popup.querySelector(".profile-empty");
  let options = [],
    active = -1,
    opened = false;
  function update() {
    input.disabled = clear.disabled = pane.busy;
    if (!opened) input.value = pane.device.name;
    clear.hidden = !input.value;
  }

  function close() {
    if (!opened) return;
    opened = false;
    popup.hidePopover();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    update();
  }
  async function choose(device) {
    close();
    input.disabled = clear.disabled = true;
    try {
      await pane.selectProfile(device);
    } catch (error) {
      onError(error);
    } finally {
      update();
    }
  }
  function highlight(position) {
    active = position;
    for (const option of list.children) option.classList.remove("highlighted");
    const item = list.children[position];
    if (item) {
      item.classList.add("highlighted");
      input.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function search(query = "") {
    query = query.trim().toLocaleLowerCase();
    options = profiles.filter((device) =>
      [device.name, device.brand].some((label) =>
        label.toLocaleLowerCase().includes(query),
      ),
    );
    list.replaceChildren();
    options.forEach((device, position) => {
      const item = document.createElement("li");
      item.id = listId + "-" + position;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(pane.device === device));
      appendMatch(item, device.name, query);
      if (query && !device.name.toLocaleLowerCase().includes(query)) {
        const brand = document.createElement("small");
        appendMatch(brand, device.brand, query);
        item.append(brand);
      }
      item.onpointerdown = (event) => event.preventDefault();
      item.onclick = () => void choose(device);
      list.append(item);
    });
    empty.hidden = options.length > 0;
    if (!opened) {
      const bounds = root.getBoundingClientRect();
      const width = Math.min(innerWidth - 16, Math.max(210, bounds.width));
      const upward = bounds.top > innerHeight - bounds.bottom;
      popup.style.width = width + "px";
      popup.style.left =
        Math.max(8, Math.min(bounds.left, innerWidth - width - 8)) + "px";
      popup.style.top = upward ? "auto" : bounds.bottom + 4 + "px";
      popup.style.bottom = upward
        ? innerHeight - bounds.top + 4 + "px"
        : "auto";
      popup.style.maxHeight =
        Math.min(
          280,
          Math.max(
            70,
            (upward ? bounds.top : innerHeight - bounds.bottom) - 12,
          ),
        ) + "px";
      popup.showPopover();
      opened = true;
      input.setAttribute("aria-expanded", "true");
    }
    clear.hidden = !input.value;
    highlight(query && options.length ? 0 : -1);
  }
  input.onfocus = () => {
    input.select();
    search();
  };
  input.oninput = () => search(input.value);
  input.onclick = () => {
    if (!opened) search();
  };
  input.onkeydown = (event) => {
    if (event.key === "Escape" && opened) {
      event.preventDefault();
      close();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!opened) search();
      if (options.length)
        highlight(
          active === -1 && event.key === "ArrowUp"
            ? options.length - 1
            : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length,
        );
    } else if (event.key === "Enter" && opened && options[active]) {
      event.preventDefault();
      void choose(options[active]);
    }
  };
  clear.onclick = () => {
    input.focus();
    input.value = "";
    search();
  };
  root.onfocusout = (event) => {
    if (!root.contains(event.relatedTarget)) close();
  };
  update();
  return { update };
}
