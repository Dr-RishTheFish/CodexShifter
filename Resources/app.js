"use strict";
const $ = (id) => document.getElementById(id),
  audio = new CarSounds();
let seq = 0,
  pending = new Map(),
  prefs = {},
  shifter = null,
  session = null,
  thread = null,
  selectedThread = null,
  connected = false,
  connecting = false,
  polling = false,
  applying = false,
  queued = null,
  applied = null,
  busy = false,
  pinned = true,
  started = 0,
  shiftVersion = 0;
const positions = {
  1: [64, 79],
  2: [64, 181],
  3: [138, 79],
  4: [138, 181],
  5: [212, 79],
  R: [212, 181],
  N: [138, 129],
};
function post(m) {
  window.webkit.messageHandlers.native.postMessage(m);
}
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(method + " timed out"));
      }, 15000);
    pending.set(id, { resolve, reject, timer });
    post({ id, method, params });
  });
}
function status(text) {
  $("status").textContent = text;
  $("status").title = text;
}
function fail(e) {
  status(e.message || String(e));
}
function save() {
  prefs.mapping = shifter?.mapping || prefs.mapping;
  prefs.sound = audio.enabled;
  rpc("native/save", prefs).catch(fail);
}
function short(s) {
  return s.replace(/^gpt-/, "").toUpperCase();
}
function render() {
  $("terminals").disabled = polling || connecting || applying;
  $("threads").disabled = polling || connecting || applying;
  $("pin").classList.toggle("on", pinned);
  $("sound").textContent = audio.enabled ? "ENGINE ON" : "ENGINE OFF";
  $("linkLamp").classList.toggle("on", connected && !!thread);
  $("busyLamp").classList.toggle("on", busy);
  $("queueLamp").classList.toggle("on", !!queued || applying);
  if (!shifter) {
    $("model").textContent = "Launch codex-shifter";
    $("ready").textContent = "WAITING";
    return;
  }
  $("gear").textContent = shifter.gear;
  $("transmission").textContent =
    shifter.gear === "N"
      ? "NEUTRAL"
      : shifter.gear === "R"
        ? "DEFAULT"
        : "ENGAGED";
  $("model").textContent = shifter.selection.model;
  $("ready").textContent = applying
    ? "SHIFTING"
    : connected && thread
      ? "LINKED"
      : "WAITING";
  $("active").textContent = applied
    ? `${applied.model} · ${applied.effort || "default"}`
    : "Waiting for terminal session";
  $("lockLamp").classList.toggle("on", shifter.locked);
  $("clutch").classList.toggle("on", shifter.locked);
  $("clutch").setAttribute("aria-pressed", String(shifter.locked));
  const efforts = shifter.efforts;
  $("effort").max = efforts.length - 1;
  $("effort").value = efforts.indexOf(shifter.selection.effort);
  $("effort").disabled = shifter.locked || !thread;
  $("effortValue").textContent = shifter.selection.effort;
  for (const b of document.querySelectorAll("[data-gear]")) {
    const g = b.dataset.gear;
    b.disabled = !thread;
    b.classList.toggle("selected", g === shifter.gear);
    b.querySelector("span").textContent =
      g === "R" ? "DEFAULT" : short(shifter.mapping[g]);
    b.title = g === "R" ? shifter.defaultModel.model : shifter.mapping[g];
  }
  const [x, y] = positions[shifter.gear];
  if (!dragging) {
    $("knob").style.left = x + "px";
    $("knob").style.top = y + "px";
  }
  $("knob").disabled = !thread;
  $("knob").title = "Gear " + shifter.gear + " · drag or click a gear";
}
function selectActual(t) {
  applied = { model: t.model, effort: t.reasoningEffort };
  if (!shifter || !shifter.models.some((m) => m.model === t.model)) return;
  const changed = shifter.selection.model !== t.model;
  shifter.selection.model = t.model;
  shifter.selection.effort = shifter.efforts.includes(t.reasoningEffort)
    ? t.reasoningEffort
    : shifter.model.defaultReasoningEffort;
  if (changed)
    shifter.gear =
      Object.keys(shifter.mapping).find(
        (g) => shifter.mapping[g] === t.model,
      ) || "N";
}
async function applySelection() {
  if (!shifter || !thread || !connected) return;
  shiftVersion++;
  queued = { ...shifter.selection, threadId: thread, session };
  render();
  if (applying) return;
  applying = true;
  try {
    while (queued) {
      const choice = queued;
      queued = null;
      if (choice.session !== session || choice.threadId !== thread) continue;
      await rpc("thread/settings/update", {
        threadId: choice.threadId,
        model: choice.model,
        effort: choice.effort,
      });
      applied = { model: choice.model, effort: choice.effort };
      status(
        busy
          ? "Shift set for the next CLI turn"
          : "CLI shifted to " + choice.model,
      );
    }
  } catch (e) {
    queued = null;
    fail(e);
    if (applied)
      selectActual({ model: applied.model, reasoningEffort: applied.effort });
  } finally {
    applying = false;
    render();
  }
}
function shift(g) {
  if (!shifter || !thread) return;
  const old = shifter.gear;
  if (shifter.shift(g)) {
    audio.shift((Number(g) || 0) >= (Number(old) || 0));
    render();
    applySelection();
  } else status("Clutch locked — press it to shift");
}
function options(select, rows, value) {
  const signature = JSON.stringify(rows);
  if (select.dataset.signature !== signature) {
    select.replaceChildren();
    for (const r of rows) select.add(new Option(r[1], r[0]));
    select.dataset.signature = signature;
  }
  select.value = value || "";
}
async function attach(id) {
  if (connecting || applying) return;
  connecting = true;
  connected = false;
  thread = null;
  selectedThread = null;
  session = id;
  applied = null;
  busy = false;
  queued = null;
  render();
  try {
    await rpc("native/connect", { sessionId: id });
    await rpc("initialize", {
      clientInfo: { name: "codex_shifter_companion", version: "1.1.0" },
      capabilities: { experimentalApi: true },
    });
    post({ method: "initialized" });
    let models = [],
      cursor;
    do {
      const r = await rpc("model/list", cursor ? { cursor } : {});
      models.push(...r.data);
      cursor = r.nextCursor;
    } while (cursor);
    shifter = new ShifterCore.Shifter(models, prefs.mapping);
    connected = true;
    buildSettings();
    status("Connected to your terminal");
  } catch (e) {
    session = null;
    fail(e);
  } finally {
    connecting = false;
    render();
  }
}
async function poll() {
  if (polling || connecting) return;
  polling = true;
  try {
    const sessions = await rpc("native/sessions");
    options(
      $("terminals"),
      sessions.length
        ? sessions.map((s) => [
            s.id,
            s.cwd.split("/").pop() +
              " · " +
              new Date(s.started * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
          ])
        : [["", "Run codex-shifter in Terminal"]],
      session,
    );
    if (!sessions.some((s) => s.id === session)) {
      connected = false;
      thread = null;
      session = null;
      applied = null;
      busy = false;
      selectedThread = null;
      if (sessions.length) {
        await attach(sessions[0].id);
      } else {
        shifter = null;
        options($("threads"), [["", "Waiting for Codex to start"]], "");
        status("In your terminal: codex-shifter");
        render();
        return;
      }
    }
    if (!connected) return;
    const observedShift = shiftVersion;
    const loaded = await rpc("thread/loaded/list", {});
    const roots = [];
    for (const id of loaded.data || []) {
      const t = (await rpc("thread/read", { threadId: id })).thread;
      if (!t.parentThreadId) roots.push(t);
    }
    // Codex may keep previous conversations loaded after /new.
    roots.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    if (!roots.some((t) => t.id === selectedThread)) selectedThread = null;
    const nextThread = selectedThread || roots[0]?.id || null;
    if (!applying && thread !== nextThread) {
      thread = nextThread;
      applied = null;
      busy = false;
      started = 0;
    }
    options(
      $("threads"),
      roots.length
        ? [
            ["", "Follow newest Codex thread"],
            ...roots.map((t) => [
              t.id,
              t.name || t.preview?.slice(0, 40) || t.id.slice(0, 8) + " · CLI",
            ]),
          ]
        : [["", "Waiting for Codex to start"]],
      selectedThread,
    );
    const current = roots.find((t) => t.id === thread);
    if (current) {
      const wasBusy = busy;
      busy = current.status?.type === "active";
      if (busy && !wasBusy) started = Date.now();
      if (!applying && !queued && observedShift === shiftVersion)
        selectActual(current);
      const usage = await rpc("native/telemetry", { threadId: thread });
      const t = ShifterCore.telemetry(Object.keys(usage).length ? usage : null);
      $("total").textContent =
        t.total === null ? "— — — — — —" : String(t.total).padStart(6, "0");
      $("fuel").textContent =
        t.contextRemaining === null
          ? "—"
          : Math.round(t.contextRemaining) + "%";
      $("fuelBar").style.width = (t.contextRemaining || 0) + "%";
      const rpm =
        busy && started
          ? ShifterCore.outputRate(usage, (Date.now() - started) / 1000)
          : 0;
      $("rpm").textContent = rpm === null ? "—" : rpm.toLocaleString();
      $("needle").style.transform =
        `rotate(${Math.min(192, ((rpm || 0) / 10000) * 192)}deg)`;
    }
    render();
  } catch (e) {
    fail(e);
  } finally {
    polling = false;
    render();
  }
}
window.receiveNative = (msg) => {
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(msg.id);
      msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "native/disconnected") {
    connected = false;
    session = null;
    thread = null;
    selectedThread = null;
    busy = false;
    applied = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(Error("Terminal disconnected"));
      pending.delete(id);
    }
    status("Terminal closed · run codex-shifter to reconnect");
    render();
  }
  if (
    msg.method === "thread/settings/updated" &&
    msg.params?.threadId === thread &&
    !applying
  ) {
    const t = msg.params.threadSettings;
    if (t) selectActual({ model: t.model, reasoningEffort: t.effort });
    render();
  }
};
function buildSettings() {
  $("mappings").replaceChildren();
  for (const g of ["1", "2", "3", "4", "5"]) {
    const row = document.createElement("div");
    row.className = "mapping";
    const label = document.createElement("label");
    label.textContent = g;
    label.htmlFor = "map" + g;
    const select = document.createElement("select");
    select.id = "map" + g;
    for (const m of shifter.models)
      select.add(new Option(m.displayName || m.model, m.model));
    select.value = shifter.mapping[g];
    select.onchange = () => {
      const active = shifter.gear === g;
      shifter.map(g, select.value);
      save();
      render();
      if (active) applySelection();
    };
    row.append(label, select);
    $("mappings").append(row);
  }
}
$("terminals").onchange = (e) => attach(e.target.value);
$("threads").onchange = (e) => {
  if (applying) return;
  selectedThread = e.target.value || null;
  thread = selectedThread;
  applied = null;
  busy = false;
  started = 0;
  render();
  return poll();
};
$("clutch").onclick = () => {
  if (!shifter) return;
  shifter.locked = !shifter.locked;
  render();
};
$("effort").onchange = (e) => {
  if (shifter && !shifter.locked) {
    shifter.setEffort(shifter.efforts[Number(e.target.value)]);
    render();
    applySelection();
  }
};
$("pin").onclick = () => {
  pinned = !pinned;
  rpc("native/pin", { pinned }).catch(fail);
  render();
};
$("sound").onclick = () => {
  audio.enabled = !audio.enabled;
  save();
  audio.shift(true);
  render();
};
$("settings").onclick = () => $("setup").showModal();
$("closeSettings").onclick = () => $("setup").close();
$("refresh").onclick = () => poll();
$("reconnect").onclick = () => {
  if (session) attach(session);
  else poll();
};
for (const b of document.querySelectorAll("[data-gear]"))
  b.onclick = () => shift(b.dataset.gear);
document.addEventListener("keydown", (e) => {
  if (
    /INPUT|SELECT/.test(e.target.tagName) ||
    $("setup").open ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  )
    return;
  const g = e.key.toUpperCase();
  if (["1", "2", "3", "4", "5", "R", "N"].includes(g)) {
    e.preventDefault();
    shift(g);
  }
});
let dragging = false;
$("knob").onpointerdown = (e) => {
  if (!shifter || shifter.locked || !thread) return;
  dragging = true;
  $("knob").classList.add("dragging");
  $("knob").setPointerCapture(e.pointerId);
};
$("knob").onpointermove = (e) => {
  if (!dragging) return;
  const r = $("gate").getBoundingClientRect(),
    x = Math.max(64, Math.min(212, e.clientX - r.left)),
    y = Math.max(79, Math.min(181, e.clientY - r.top)),
    col = [64, 138, 212].reduce((a, b) =>
      Math.abs(x - a) < Math.abs(x - b) ? a : b,
    ),
    horizontal = Math.abs(y - 129) <= Math.abs(x - col);
  $("knob").style.left = (horizontal ? x : col) + "px";
  $("knob").style.top = (horizontal ? 129 : y) + "px";
};
$("knob").onpointerup = (e) => {
  if (!dragging) return;
  dragging = false;
  $("knob").classList.remove("dragging");
  const r = $("gate").getBoundingClientRect(),
    x = e.clientX - r.left,
    y = e.clientY - r.top,
    i = [64, 138, 212].indexOf(
      [64, 138, 212].reduce((a, b) =>
        Math.abs(x - a) < Math.abs(x - b) ? a : b,
      ),
    );
  shift(y < 105 ? ["1", "3", "5"][i] : y > 153 ? ["2", "4", "R"][i] : "N");
};
$("knob").onpointercancel = () => {
  dragging = false;
  $("knob").classList.remove("dragging");
  render();
};
for (let i = 0; i <= 10; i++) {
  const a = ((174 + i * 19.2) * Math.PI) / 180,
    line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const [k, v] of Object.entries({
    x1: 100 + Math.cos(a) * 68,
    y1: 100 + Math.sin(a) * 68,
    x2: 100 + Math.cos(a) * 77,
    y2: 100 + Math.sin(a) * 77,
    stroke: i > 7 ? "#ed7858" : "#a1aaa1",
    "stroke-width": i % 2 ? 1 : 2,
  }))
    line.setAttribute(k, v);
  $("ticks").append(line);
}
(async () => {
  try {
    prefs = await rpc("native/preferences");
    audio.enabled = prefs.sound !== false;
    await rpc("native/start", { restart: true });
    render();
    await poll();
    setInterval(poll, 1500);
  } catch (e) {
    fail(e);
  }
})();
