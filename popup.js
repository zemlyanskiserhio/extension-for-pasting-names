const namesEl = document.getElementById("names");
const pauseEl = document.getElementById("pause");
const countEl = document.getElementById("count");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const problemLabel = document.getElementById("problemLabel");
const problemsEl = document.getElementById("problems");

function parseNames(raw) {
  return String(raw || "")
    .split(/[;\n\r]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 1);
}

function setStatus(text) {
  statusEl.textContent = text;
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
  await chrome.storage.local.set({ draft: namesEl.value, pause });
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
    setStatus(describe(status));
    renderLog(status);
    const running = !!status?.running;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
  } catch (error) {
    setStatus(error.message);
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
});

pauseEl.addEventListener("change", saveDraft);

chrome.storage.local.get(["draft", "pause"]).then((saved) => {
  if (typeof saved.draft === "string") namesEl.value = saved.draft;
  if (saved.pause) pauseEl.value = String(saved.pause);
  updateCount();
  refreshStatus().then(startPolling);
});
