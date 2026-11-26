import { devices, desktop } from "./devices.mjs";
import { normalizeUrl } from "./urls.mjs";
import { icon } from "./icons.mjs";
import { createPane, resizeColumns } from "./pane.mjs";
import { profilePicker } from "./profile-picker.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const address = $("#address");
const comparison = $("#comparison");
const views = $("#views");
const gpu = $("#gpu");
const template = $("#workspace").cloneNode(true);
resizeColumns(views);
const demoUrl = new URL("./demo.html", location.href).href;
let primary,
  leader,
  category = "all",
  changing = false,
  editing = false;
let inputQueue = Promise.resolve();
const panes = [];
const pickers = new WeakMap();

const storage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
gpu.checked = storage.get("forma-gpu") === "on";
gpu.onchange = () => storage.set("forma-gpu", gpu.checked ? "on" : "off");

for (const el of $$("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
function theme(value) {
  document.documentElement.dataset.theme = value;
  storage.set("forma-theme", value);
  for (const btn of $$("[data-theme-value]"))
    btn.setAttribute("aria-pressed", String(btn.dataset.themeValue === value));
}
theme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
for (const btn of $$("[data-theme-value]"))
  btn.onclick = () => theme(btn.dataset.themeValue);
function notice(msg = "") {
  const n = $("#notice");
  n.textContent = msg;
  n.hidden = !msg;
}
function catalog() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const rows = devices.filter(
    (d) =>
      (category === "all" || d.tablet === (category === "tablet")) &&
      (d.name + " " + d.brand).toLocaleLowerCase().includes(query),
  );
  $("#count").textContent = String(rows.length);
  const list = $("#catalog");
  list.replaceChildren();
  for (const d of rows) {
    const b = document.createElement("button");
    b.className = "entry";
    b.dataset.id = d.id;
    b.setAttribute("aria-pressed", String(d === primary.device));
    b.innerHTML =
      '<span class="mini">' +
      icon(d.tablet ? "tablet" : "phone") +
      "</span><span><b>" +
      d.name +
      "</b><small>" +
      d.brand +
      " · " +
      d.w +
      " × " +
      d.h +
      "</small></span>" +
      (d === primary.device
        ? '<span class="tick">' + icon("check") + "</span>"
        : "");
    b.onclick = () => changeProfile(d);
    list.append(b);
  }
  if (!rows.length) {
    const msg = document.createElement("p");
    msg.className = "empty";
    msg.textContent = "No se encontraron modelos.";
    list.append(msg);
  }
  for (const b of $$("#filters button"))
    b.setAttribute("aria-pressed", String(b.dataset.type === category));
}
$("#search").oninput = catalog;
for (const b of $$("#filters button"))
  b.onclick = () => {
    category = b.dataset.type;
    catalog();
  };
function library(open) {
  document.body.classList.toggle("library-open", open);
  $("#library").setAttribute("aria-expanded", String(open));
  if (open) $("#search").focus();
  else if (matchMedia("(max-width:740px)").matches) $("#library").focus();
}
$("#library").onclick = () => library(true);
$("#close-library").onclick = () => library(false);
function collapseSidebar(collapsed, focus = false) {
  const rail = $(".sidebar-rail");
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  rail.hidden = !collapsed;
  storage.set("forma-sidebar", collapsed ? "collapsed" : "open");
  if (focus) $(collapsed ? "#show-sidebar" : "#hide-sidebar").focus();
}
collapseSidebar(storage.get("forma-sidebar") === "collapsed");
$("#show-sidebar").onclick = () => collapseSidebar(false, true);
$("#hide-sidebar").onclick = () => collapseSidebar(true, true);
document.addEventListener("click", (e) => {
  if (
    document.body.classList.contains("library-open") &&
    !e.target.closest("#sidebar,#library")
  )
    library(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("library-open"))
    library(false);
});

const engineStatus = fetch("./api/status", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}));
const engineAvailable = engineStatus.then((status) => status?.app === "forma");
void engineStatus.then((status) => {
  const local = status?.app === "forma";
  const warning = $("#settings-warning");
  $("#display-fields").disabled = status?.display !== true;
  if (!status?.display) {
    warning.textContent = local
      ? "Estás en una versión anterior del motor. Abre Iniciar.cmd para cargar la versión nueva y conservar estas vistas."
      : "Abre Iniciar.cmd para usar la configuración de pantalla y los motores de emulación.";
    warning.hidden = false;
  }
  if (!local) return;
  const option = $("#gpu-option");
  const help = $("#gpu-help");
  gpu.disabled = status.gpu !== true;
  if (gpu.disabled) {
    const message = "Abre Iniciar.cmd o entra en Configuración para abrir el motor actualizado.";
    option.title = help.textContent = message;
  }
  option.hidden = help.hidden = false;
});
async function api(path, data, signal) {
  const res = await fetch("./api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(j.error || "El motor local no responde.");
    e.status = res.status;
    throw e;
  }
  return signal ? res : res.json();
}

function error(e) {
  notice(e.message);
}
function setAddress(url) {
  if (!editing && document.activeElement !== address)
    address.value = url === demoUrl ? "" : url;
}
function onUrl(pane, url) {
  if (pane !== leader || changing || !url) return;
  setAddress(url);
  // The page driving the interaction owns navigation, including delayed redirects.
  for (const other of panes) {
    if (other !== pane && other.session && !other.busy && other.url !== url) {
      void other
        .open(url)
        .then(() => {
          if (leader === pane && pane.url !== url) onUrl(pane, pane.url);
        })
        .catch(error);
    }
  }
}
const callbacks = {
  api,
  gpu: () => gpu.checked,
  error,
  notice,
  render(pane) {
    if (pane === primary) catalog();
    pickers.get(pane)?.update();
  },
  drain: () => inputQueue,
  url: onUrl,
  input(pane, action, values) {
    if (changing) return Promise.resolve();
    leader = pane;
    const peers = panes
      .filter((other) => other !== pane && !other.busy && other.session)
      .map((other) => other.session);
    inputQueue = inputQueue
      .then(() => api("action", { id: pane.session, action, ...values, peers }))
      .catch(error);
    return inputQueue;
  },
  async navigate(pane, action) {
    if (changing) return;
    leader = pane;
    try {
      if (action === "reload")
        await Promise.all(panes.map((other) => other.navigation(action)));
      else await pane.navigation(action);
    } catch (e) {
      error(e);
    }
  },
};

const preferred = devices.find((d) => d.id === storage.get("forma-device"));
primary = createPane($("#workspace"), preferred || devices[0], callbacks);
panes.push(primary);
leader = primary;
catalog();
addProfilePicker(primary, 0);

const settings = $("#settings-dialog");
const displayView = $("#display-view");
const displayFields = $("#display-fields");
const settingsError = $("#settings-error");
function fillDisplay(values) {
  $("#display-width").value = values.width;
  $("#display-height").value = values.height;
  $("#display-dpr").value = values.dpr;
  $("#display-sharp").checked = values.sharp;
  settingsError.hidden = true;
}
$("#settings").onclick = async () => {
  const status = await engineStatus;
  if (settings.open) return;
  displayView.replaceChildren(...panes.map((pane, index) =>
    new Option(`Vista ${index + 1} · ${pane.device.name}`, index),
  ));
  displayView.value = String(panes.indexOf(leader));
  fillDisplay((panes[Number(displayView.value)] || primary).display);
  settings.showModal();
  if (status?.app === "forma" && !status.display && ["4317", "4318"].includes(location.port)) {
    const url = `http://127.0.0.1:${location.port === "4317" ? 4318 : 4317}/`;
    const other = await fetch(url + "api/status", { signal: AbortSignal.timeout(850) })
      .then((res) => res.ok ? res.json() : null).catch(() => null);
    if (other?.app === "forma" && other.display) {
      $("#updated-engine a").href = url;
      $("#updated-engine").hidden = false;
    }
  }
};
$("#close-settings").onclick = () => settings.close();
displayView.onchange = () => fillDisplay(panes[Number(displayView.value)].display);
$("#reset-display").onclick = () => fillDisplay(panes[Number(displayView.value)].defaultDisplay);
$("#settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const pane = panes[Number(displayView.value)];
  if (!pane || changing || pane.busy || displayFields.disabled) return;
  const values = {
    width: $("#display-width").valueAsNumber,
    height: $("#display-height").valueAsNumber,
    dpr: $("#display-dpr").valueAsNumber,
    sharp: $("#display-sharp").checked,
  };
  displayFields.disabled = true;
  settingsError.hidden = true;
  try {
    await pane.configureDisplay(values);
    settings.close();
  } catch (err) {
    settingsError.textContent = err.message;
    settingsError.hidden = false;
  } finally {
    displayFields.disabled = false;
  }
};

async function run(fn) {
  if (changing) return;
  changing = true;
  comparison.disabled = $("#load").disabled = true;
  notice();
  try {
    await inputQueue;
    await Promise.all(panes.map((pane) => pane.idle()));
    await fn();
  } catch (e) {
    error(e);
  } finally {
    changing = false;
    comparison.disabled = $("#load").disabled = false;
    comparison.value = String(panes.length);
    comparison.options[0].text = panes.length > 1 ? "1 vista" : "Comparar";
    views.dataset.count = comparison.value;
    if (leader.url) onUrl(leader, leader.url);
  }
}
async function changeProfile(device) {
  if (changing || primary.busy) return;
  if (document.body.classList.contains("library-open")) library(false);
  try {
    await primary.selectProfile(device);
    storage.set("forma-device", device.id);
  } catch (e) {
    error(e);
  }
}
address.oninput = () => {
  editing = true;
};
$("#url-form").onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    const url = normalizeUrl(address.value);
    const local = await engineAvailable;
    const results = await Promise.allSettled(
      panes.map((pane) => pane.open(url, local, { gpu: gpu.checked })),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    editing = false;
    address.blur();
    setAddress(leader.url || url);
    if (!local)
      notice(
        "Abre Iniciar.cmd para usar la emulación táctil y la comparación sincronizada.",
      );
  });
};
function appendPane(device, index) {
  const root = template.cloneNode(true);
  root.setAttribute("aria-label", "Vista " + (index + 1));
  root.style.setProperty("--pane-column", String(index * 2 + 2));
  const stage = root.querySelector(".stage");
  stage.setAttribute("aria-label", "Dispositivo " + (index + 1));
  views.insertBefore(root, index === 1 ? $("#column-grip-2") : $(".edge-grip[data-edge=right]"));
  const pane = createPane(root, device, callbacks, "-" + (index + 1));
  addProfilePicker(pane, index);
  return pane;
}
function addProfilePicker(pane, index) {
  pickers.set(pane, profilePicker(pane, index, [...devices, desktop], error));
}
comparison.onchange = () => {
  const count = Number(comparison.value);
  void run(async () => {
    if (count > 1 && !(await engineAvailable))
      throw new Error(
        "La comparación necesita el motor local de UITESTER. Abre Iniciar.cmd.",
      );
    if (leader !== primary && count <= panes.indexOf(leader)) leader = primary;
    while (panes.length > count) await panes.pop().close(true);
    if (panes.length === count) return;
    const url = leader.url || demoUrl;
    if (!leader.session) await leader.open(url);
    const added = [];
    while (panes.length !== count) {
      const device =
        panes.length === 1 ? devices[primary.device.tablet ? 0 : 4] : desktop;
      const pane = appendPane(device, panes.length);
      panes.push(pane);
      added.push(pane);
    }
    views.dataset.count = String(panes.length);
    const results = await Promise.allSettled(
      added.map((pane) => pane.open(url, true, { source: leader.session })),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      await Promise.allSettled(added.map((pane) => pane.close(true)));
      panes.splice(panes.length - added.length);
      throw failed.reason;
    }
  });
};
document.addEventListener("fullscreenchange", () => {
  for (const pane of panes) {
    const button = pane.root.querySelector('[data-part="expand"]');
    const label =
      document.fullscreenElement === pane.root
        ? "Salir de pantalla completa"
        : "Pantalla completa";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
});
$("#help").onclick = () => $("#guide").showModal();
$("#close-guide").onclick = () => $("#guide").close();
$("#reset-demo").onclick = () => {
  $("#guide").close();
  void run(async () => {
    editing = false;
    address.value = "";
    if (panes.length > 1)
      await Promise.all(panes.map((pane) => pane.open(demoUrl)));
    else await primary.close();
  });
};
const tabSessionsKey = "forma-tab-sessions";
let restoringSessions = false;
async function restoreSessions() {
  let ids;
  try {
    ids = JSON.parse(sessionStorage.getItem(tabSessionsKey));
  } catch {
    return;
  }
  if (!Array.isArray(ids) || !ids[0]) return;
  restoringSessions = true;
  try {
    await run(async () => {
      await primary.resume(ids[0]);
      for (const id of ids.slice(1, 3)) {
        if (!id) continue;
        const pane = appendPane(desktop, panes.length);
        try {
          await pane.resume(id);
          panes.push(pane);
        } catch (e) {
          await pane.close(true);
          error(e);
        }
      }
    });
  } finally {
    restoringSessions = false;
    try {
      sessionStorage.removeItem(tabSessionsKey);
    } catch {}
  }
}
addEventListener("pagehide", () => {
  if (restoringSessions) return;
  try {
    sessionStorage.setItem(
      tabSessionsKey,
      JSON.stringify(panes.map((pane) => pane.session)),
    );
  } catch {}
});
void restoreSessions();
