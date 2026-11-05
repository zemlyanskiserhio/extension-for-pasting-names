const namesEl = document.getElementById("names");
const pauseEl = document.getElementById("pause");
const countEl = document.getElementById("count");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const problemLabel = document.getElementById("problemLabel");
const problemsEl = document.getElementById("problems");
const keysEl = document.getElementById("keys");
const appEl = document.getElementById("app");
const drawerTab = document.getElementById("drawerTab");
const drawerEl = document.getElementById("drawer");
const pianoMark = document.getElementById("pianoMark");
let menuOpen = false;
const newListBtn = document.getElementById("newList");
const createBox = document.getElementById("createBox");
const createName = document.getElementById("createName");
const createMeta = document.getElementById("createMeta");
const createSave = document.getElementById("createSave");
const editingBar = document.getElementById("editing");
const editingName = document.getElementById("editingName");
const editingSave = document.getElementById("editingSave");
const editingClear = document.getElementById("editingClear");
const meetTitle = document.getElementById("meetTitle");
const meetPlace = document.getElementById("meetPlace");
const meetLink = document.getElementById("meetLink");
const meetTemplate = document.getElementById("meetTemplate");
const meetPreview = document.getElementById("meetPreview");
const fillMeet = document.getElementById("fillMeet");
const copyMeet = document.getElementById("copyMeet");
const resetMeet = document.getElementById("resetMeet");

const DEFAULT_TITLE = "Встреча о том о сем";
const DEFAULT_LINK = "https://alfabank.ktalk.ru/zemlyanskiy";
const DEFAULT_TEMPLATE = "ял яля";

let lists = [];
let openId = null;
let editingId = null;
let renamingId = null;
let confirmDeleteId = null;
let creating = false;
let skipRenameBlur = false;
let confirmTimer = 0;
let meetTimer = 0;

function storageGet(keys) {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve({});
  return chrome.storage.local.get(keys);
}

function storageSet(data) {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  return chrome.storage.local.set(data);
}

function parseNames(raw) {
  return String(raw || "")
    .split(/[;\n\r]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 1);
}

let localStatusUntil = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function setLocalStatus(text) {
  localStatusUntil = Date.now() + 2800;
  setStatus(text);
}

function setPageStatus(text) {
  if (Date.now() < localStatusUntil) return;
  setStatus(text);
}

function renderLog(status) {
  const lines = [];
  if (status && !status.running && status.total) {
    for (const name of status.failed || []) lines.push({ text: `Failed: ${name}`, kind: "bad" });
    for (const name of status.skipped || []) lines.push({ text: `Skipped: ${name}`, kind: "" });
    if (!lines.length) lines.push({ text: "None failed or skipped.", kind: "ok" });
  } else {
    lines.push(...(status?.log || []));
  }
  logEl.replaceChildren();
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line.text;
    if (line.kind) li.className = line.kind;
    logEl.appendChild(li);
  }
  const names = status && !status.running && status.total
    ? [...(status.failed || []), ...(status.skipped || [])]
    : [];
  const text = names.join("; ");
  problemLabel.hidden = !text;
  problemsEl.hidden = !text;
  if (problemsEl.value !== text) {
    problemsEl.value = text;
    if (text) {
      problemsEl.focus();
      problemsEl.select();
    }
  }
}

function updateCount() {
  const n = parseNames(namesEl.value).length;
  countEl.textContent = n === 1 ? "1 person" : `${n} people`;
}

async function saveDraft() {
  const pause = Math.min(5000, Math.max(200, Number(pauseEl.value) || 600));
  await storageSet({ draft: namesEl.value, pause });
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `list-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function miniButton(text, title, onClick) {
  const button = el("button", "", text);
  button.type = "button";
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function sanitizeLists(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
    .map((item) => ({
      id: item.id,
      name: String(item.name || "List").replace(/\s+/g, " ").trim().slice(0, 40) || "List",
      text: String(item.text),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function peopleLabel(count) {
  return count === 1 ? "1 person" : `${count} people`;
}

function savedLabel(list) {
  const when = new Date(list.updatedAt);
  if (Number.isNaN(when.getTime())) return "Saved";
  const sameDay = new Date().toDateString() === when.toDateString();
  if (sameDay) return `Updated ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `Updated ${when.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

function persistLists() {
  return storageSet({ lists });
}

function syncCreate() {
  createBox.hidden = !creating;
  newListBtn.textContent = creating ? "✕ Cancel" : "＋ Save list";
  const count = parseNames(namesEl.value).length;
  createMeta.textContent = count
    ? `Saves ${peopleLabel(count)} from the field.`
    : "The field is empty.";
  createSave.disabled = count === 0;
}

function syncEditingBar() {
  const list = lists.find((item) => item.id === editingId);
  if (!list) {
    editingId = null;
    editingBar.hidden = true;
    namesEl.classList.remove("is-editing");
    return;
  }
  editingBar.hidden = false;
  editingName.textContent = `✏️ ${list.name}`;
  namesEl.classList.add("is-editing");
}

function buildKeyBody(list) {
  const body = el("div", "key-body");
  const count = parseNames(list.text).length;
  body.append(
    el("p", "key-meta", `${peopleLabel(count)} · ${savedLabel(list)}`),
    el("p", "key-hint", "Save stores the names field in this list."),
    el("p", "key-preview", list.text.trim())
  );
  const crud = el("div", "crud");
  const editingThis = editingId === list.id;
  const saveButton = miniButton("💾 Save", "Save the main field into this list", () => saveInto(list.id));
  if (editingThis) saveButton.classList.add("accent");
  const deleteButton = miniButton(
    confirmDeleteId === list.id ? "✓ Yes" : "🗑️ Delete",
    confirmDeleteId === list.id ? "Click again to delete this list" : "Delete this list",
    () => {
      if (confirmDeleteId === list.id) deleteList(list.id);
      else armDelete(list.id);
    }
  );
  if (confirmDeleteId === list.id) deleteButton.classList.add("danger");
  crud.append(
    miniButton(
      editingThis ? "✏️ Editing" : "✏️ Edit",
      "Load this list into the main field",
      () => editList(list.id)
    ),
    miniButton("🏷 Rename", "Rename this list", () => {
      confirmDeleteId = null;
      renamingId = list.id;
      renderKeys();
    }),
    saveButton,
    deleteButton
  );
  body.appendChild(crud);
  return body;
}

function renderKeys() {
  const mark = lists.length ? `Lists · ${lists.length}` : "Lists";
  pianoMark.textContent = mark;
  drawerTab.textContent = mark;
  keysEl.replaceChildren();
  if (!lists.length) {
    keysEl.appendChild(el("p", "keys-empty", "Paste names, then save a list. It stays here after a reload."));
  }
  lists.forEach((list) => {
    const item = el("section", "key");
    if (openId === list.id) item.classList.add("open");
    if (editingId === list.id) item.classList.add("current");
    const top = el("div", "key-top");
    if (renamingId === list.id) {
      const input = el("input", "key-rename");
      input.type = "text";
      input.maxLength = 40;
      input.value = list.name;
      input.spellcheck = false;
      input.setAttribute("aria-label", "List name");
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          skipRenameBlur = true;
          renamingId = null;
          renderKeys();
        } else if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        if (skipRenameBlur) {
          skipRenameBlur = false;
          return;
        }
        commitRename(list.id, input.value);
      });
      top.appendChild(input);
      item.appendChild(top);
      keysEl.appendChild(item);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return;
    }
    const face = el("button", "key-face");
    face.type = "button";
    face.title = list.name;
    face.setAttribute("aria-expanded", openId === list.id ? "true" : "false");
    face.append(
      el("span", "key-emoji", "👥"),
      el("span", "key-name", list.name),
      el("span", "key-count", String(parseNames(list.text).length))
    );
    face.addEventListener("click", () => {
      confirmDeleteId = null;
      renamingId = null;
      openId = openId === list.id ? null : list.id;
      renderKeys();
      keysEl.querySelector(".key.open")?.scrollIntoView({ block: "nearest" });
    });
    top.appendChild(face);
    item.appendChild(top);
    if (openId === list.id) item.appendChild(buildKeyBody(list));
    keysEl.appendChild(item);
  });
  syncEditingBar();
}

function editList(id) {
  const list = lists.find((item) => item.id === id);
  if (!list) return;
  editingId = id;
  openId = id;
  namesEl.value = list.text;
  updateCount();
  saveDraft();
  setLocalStatus(`Editing «${list.name}». Change the field, then Save.`);
  renderKeys();
  namesEl.focus();
}

async function saveInto(id) {
  const list = lists.find((item) => item.id === id);
  if (!list) return;
  if (!parseNames(namesEl.value).length) {
    setLocalStatus("Paste at least one name before saving.");
    namesEl.focus();
    return;
  }
  list.text = namesEl.value;
  list.updatedAt = Date.now();
  editingId = id;
  try {
    await persistLists();
    setLocalStatus(`Saved «${list.name}».`);
  } catch (error) {
    setLocalStatus(error.message);
  }
  renderKeys();
}

function commitRename(id, value) {
  const list = lists.find((item) => item.id === id);
  renamingId = null;
  if (!list) {
    renderKeys();
    return;
  }
  const name = value.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) {
    setLocalStatus("Type a name for the list.");
    renderKeys();
    return;
  }
  list.name = name;
  list.updatedAt = Date.now();
  persistLists().catch((error) => setLocalStatus(error.message));
  setLocalStatus(`Renamed to «${name}».`);
  renderKeys();
}

function armDelete(id) {
  confirmDeleteId = id;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => {
    if (confirmDeleteId !== id) return;
    confirmDeleteId = null;
    renderKeys();
  }, 4000);
  renderKeys();
}

async function deleteList(id) {
  const list = lists.find((item) => item.id === id);
  lists = lists.filter((item) => item.id !== id);
  if (editingId === id) editingId = null;
  if (openId === id) openId = null;
  confirmDeleteId = null;
  clearTimeout(confirmTimer);
  try {
    await persistLists();
    setLocalStatus(list ? `Deleted «${list.name}».` : "Deleted.");
  } catch (error) {
    setLocalStatus(error.message);
  }
  renderKeys();
}

async function createList() {
  if (!parseNames(namesEl.value).length) {
    setLocalStatus("Paste at least one name, then save a list.");
    namesEl.focus();
    return;
  }
  const name = createName.value.replace(/\s+/g, " ").trim().slice(0, 40) || `List ${lists.length + 1}`;
  const list = {
    id: uid(),
    name,
    text: namesEl.value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  lists.unshift(list);
  creating = false;
  openId = list.id;
  editingId = list.id;
  createName.value = "";
  syncCreate();
  try {
    await persistLists();
    setLocalStatus(`Saved «${name}».`);
  } catch (error) {
    setLocalStatus(error.message);
  }
  renderKeys();
}

function ensureMeetingDefaults() {
  if (!meetTitle.value.trim()) meetTitle.value = DEFAULT_TITLE;
  if (!meetLink.value.trim()) meetLink.value = DEFAULT_LINK;
  if (!meetPlace.value.trim()) meetPlace.value = DEFAULT_LINK;
  if (!meetTemplate.value.trim()) meetTemplate.value = DEFAULT_TEMPLATE;
}

function meetingParts() {
  ensureMeetingDefaults();
  const link = meetLink.value.trim() || DEFAULT_LINK;
  const place = (meetPlace.value.trim() || link).slice(0, 255);
  const source = meetTemplate.value.trim() ? meetTemplate.value : DEFAULT_TEMPLATE;
  let body = source.replaceAll("{place}", place).replaceAll("{link}", link);
  if (link && !body.includes(link)) body = `${body.trim()}\n\n${link}`;
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return {
    title: (meetTitle.value.trim() || DEFAULT_TITLE).slice(0, 255),
    place,
    body,
  };
}

function renderPreview() {
  const parts = meetingParts();
  const text = [
    `Название — ${parts.title}`,
    `Место — ${parts.place || "место встречи"}`,
    `Тело —\n${parts.body || "ял яля"}`,
  ].join("\n");
  meetPreview.textContent = text;
  return parts;
}

function scheduleMeetingSave() {
  renderPreview();
  clearTimeout(meetTimer);
  meetTimer = setTimeout(() => {
    storageSet({
      meeting: {
        title: meetTitle.value,
        place: meetPlace.value,
        link: meetLink.value,
        template: meetTemplate.value,
      },
    }).catch((error) => setLocalStatus(error.message));
  }, 200);
}

function applyMeeting(saved) {
  const meeting = saved && typeof saved === "object" ? saved : null;
  if (!meeting) return;
  if (typeof meeting.title === "string" && meeting.title.trim()) meetTitle.value = meeting.title;
  if (typeof meeting.place === "string" && meeting.place.trim()) meetPlace.value = meeting.place;
  if (typeof meeting.link === "string" && meeting.link.trim()) meetLink.value = meeting.link;
  if (typeof meeting.template === "string" && meeting.template.trim()) meetTemplate.value = meeting.template;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    throw new Error("Open the Outlook meeting page first.");
  }
  return tab;
}

async function inject(tabId) {
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ["content.js"] });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

async function callPage(tabId, func, args) {
  const run = (target) => chrome.scripting.executeScript({ target, func, args });
  try {
    return await run({ tabId, allFrames: true });
  } catch {
    return await run({ tabId });
  }
}

function bestStatus(results) {
  const list = (results || []).map((entry) => entry.result).filter(Boolean);
  return (
    list.find((status) => status.running) ||
    list.find((status) => status.total) ||
    list.find((status) => status.hasField) ||
    list[0] ||
    null
  );
}

function describe(status) {
  if (!status) return "Could not reach the page. Refresh Outlook and try again.";
  if (!status.hasField && !status.running && !status.total) {
    return "The «Добавьте людей» field is not on this page. Open the meeting form first.";
  }
  if (status.running) {
    return `Adding ${status.current} of ${status.total}: ${status.name}`;
  }
  if (status.total) {
    const head = status.message || "Done";
    return `${head}. Added ${status.added.length}, skipped ${status.skipped.length}, failed ${status.failed.length}.`;
  }
  return status.hasField
    ? "Field found. Paste names and start."
    : "The «Добавьте людей» field is not on this page.";
}

let pollTimer = 0;
let hookedTabId = 0;

async function refreshStatus() {
  try {
    const tab = await activeTab();
    if (hookedTabId !== tab.id) {
      await inject(tab.id);
      hookedTabId = tab.id;
    }
    let results = await callPage(tab.id, () => window.__owaBulkAddStatus?.() || null);
    let status = bestStatus(results);
    if (!status) {
      await inject(tab.id);
      hookedTabId = tab.id;
      results = await callPage(tab.id, () => window.__owaBulkAddStatus?.() || null);
      status = bestStatus(results);
    }
    setPageStatus(describe(status));
    renderLog(status);
    const running = !!status?.running;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
  } catch (error) {
    setPageStatus(error.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshStatus, 400);
}

startBtn.addEventListener("click", async () => {
  const names = parseNames(namesEl.value);
  updateCount();
  if (!names.length) {
    setStatus("Paste at least one name.");
    return;
  }
  const pauseMs = Math.min(5000, Math.max(200, Number(pauseEl.value) || 600));
  pauseEl.value = String(pauseMs);
  startBtn.disabled = true;
  setStatus("Starting…");
  let tabId = 0;
  try {
    const tab = await activeTab();
    tabId = tab.id;
    await attachDebugger(tab.id);
    await saveDraft();
    await inject(tab.id);
    const results = await callPage(
      tab.id,
      (list, options) => window.__owaBulkAddStart?.(list, options) || { ok: false, reason: "not-loaded" },
      [names, { pauseMs }]
    );
    const hit = (results || []).map((entry) => entry.result).find((result) => result?.ok);
    if (!hit) {
      const reason = (results || []).map((entry) => entry.result?.reason).find(Boolean);
      setStatus(
        reason === "busy"
          ? "Already adding people on this page."
          : "The «Добавьте людей» field is not on this page. Open the meeting form first."
      );
      await detachDebugger(tabId);
      startBtn.disabled = false;
      return;
    }
    stopBtn.disabled = false;
    startPolling();
    await refreshStatus();
  } catch (error) {
    if (tabId) await detachDebugger(tabId);
    setStatus(error.message);
    startBtn.disabled = false;
  }
});

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    const message = String(error?.message || error);
    if (/already attached/i.test(message)) return;
    throw new Error(`Could not type into Outlook: ${message}`);
  }
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* The banner may already be gone. */
  }
}

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    const tab = await activeTab();
    await callPage(tab.id, () => window.__owaBulkAddStop?.());
  } catch (error) {
    setStatus(error.message);
  }
  await refreshStatus();
});

problemsEl.addEventListener("focus", () => problemsEl.select());
problemsEl.addEventListener("click", () => problemsEl.select());

namesEl.addEventListener("input", () => {
  updateCount();
  saveDraft();
  if (creating) syncCreate();
});

pauseEl.addEventListener("change", saveDraft);

newListBtn.addEventListener("click", () => {
  if (!creating && !parseNames(namesEl.value).length) {
    setLocalStatus("Paste at least one name, then save a list.");
    namesEl.focus();
    return;
  }
  creating = !creating;
  if (creating) {
    openId = null;
    renamingId = null;
    renderKeys();
  }
  syncCreate();
  if (creating) createName.focus();
});

createSave.addEventListener("click", createList);
createName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createList();
  } else if (event.key === "Escape") {
    creating = false;
    syncCreate();
  }
});

editingSave.addEventListener("click", () => {
  if (editingId) saveInto(editingId);
});

editingClear.addEventListener("click", () => {
  editingId = null;
  renderKeys();
});

for (const field of [meetTitle, meetPlace, meetLink, meetTemplate]) {
  field.addEventListener("input", scheduleMeetingSave);
}

fillMeet.addEventListener("click", async () => {
  const parts = renderPreview();
  fillMeet.disabled = true;
  setLocalStatus("Filling the meeting form…");
  let tabId = 0;
  try {
    const tab = await activeTab();
    tabId = tab.id;
    await attachDebugger(tab.id);
    await inject(tab.id);
    const results = await callPage(
      tab.id,
      (details) => window.__owaFillMeeting?.(details) || { ok: false, reason: "not-loaded" },
      [parts]
    );
    const hit = (results || []).map((entry) => entry.result).find((result) => result?.ok);
    if (!hit) {
      const reason = (results || []).map((entry) => entry.result?.reason).find(Boolean);
      setLocalStatus(
        reason === "busy"
          ? "Already adding people on this page."
          : "Open the meeting form first. The title, place, and body fields are not on this page."
      );
      return;
    }
    const filled = hit.filled || [];
    const missed = hit.missed || [];
    if (!filled.length) setLocalStatus("Nothing to put into the meeting form.");
    else if (missed.length) setLocalStatus(`Filled ${filled.join(", ")}. Could not find ${missed.join(", ")}.`);
    else setLocalStatus(`Filled ${filled.join(", ")}.`);
  } catch (error) {
    setLocalStatus(error.message);
  } finally {
    if (tabId) await detachDebugger(tabId);
    fillMeet.disabled = false;
  }
});

copyMeet.addEventListener("click", async () => {
  const parts = renderPreview();
  const text = [parts.title, parts.place, parts.body].filter(Boolean).join("\n\n");
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
      copied = document.execCommand("copy");
    } finally {
      area.remove();
    }
  }
  if (!copied) {
    setLocalStatus("Could not copy. Select the preview and copy it.");
    return;
  }
  setLocalStatus("Meeting note copied.");
  copyMeet.textContent = "✓ Copied";
  setTimeout(() => {
    copyMeet.textContent = "📋 Copy note";
  }, 1500);
});

resetMeet.addEventListener("click", () => {
  meetTitle.value = DEFAULT_TITLE;
  meetPlace.value = DEFAULT_LINK;
  meetLink.value = DEFAULT_LINK;
  meetTemplate.value = DEFAULT_TEMPLATE;
  scheduleMeetingSave();
  setLocalStatus("Template reset to the stub.");
});

function setMenuOpen(open) {
  menuOpen = open;
  appEl.classList.toggle("menu-open", open);
  drawerTab.setAttribute("aria-expanded", open ? "true" : "false");
  drawerEl.setAttribute("aria-hidden", open ? "false" : "true");
  drawerEl.inert = !open;
  drawerTab.title = open ? "Hide saved lists" : "Saved lists";
}

drawerTab.addEventListener("click", () => setMenuOpen(!menuOpen));

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.key !== "Escape" || (target instanceof Element && target.closest("input, textarea"))) return;
  if (creating || openId || renamingId) {
    creating = false;
    openId = null;
    renamingId = null;
    confirmDeleteId = null;
    syncCreate();
    renderKeys();
    return;
  }
  if (menuOpen) setMenuOpen(false);
});

ensureMeetingDefaults();
setMenuOpen(false);
renderPreview();
syncCreate();
renderKeys();

storageGet(["draft", "pause", "lists", "meeting"]).then((saved) => {
  if (typeof saved.draft === "string") namesEl.value = saved.draft;
  if (saved.pause) pauseEl.value = String(saved.pause);
  lists = sanitizeLists(saved.lists);
  applyMeeting(saved.meeting);
  ensureMeetingDefaults();
  updateCount();
  renderKeys();
  renderPreview();
  if (globalThis.chrome?.tabs) refreshStatus().then(startPolling);
});
