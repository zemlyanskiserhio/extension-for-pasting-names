const PROTOCOL = "1.3";

const CHORDS = {
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  selectAll: { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 },
};

async function attach(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL);
  } catch (error) {
    const message = String(error?.message || error);
    if (!/already attached/i.test(message)) throw error;
  }
}

async function dispatch(tabId, method, params) {
  await attach(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function chord(tabId, name) {
  const spec = CHORDS[name];
  if (!spec) throw new Error(`Unknown key: ${name}`);
  const base = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
    modifiers: spec.modifiers || 0,
  };
  await dispatch(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await dispatch(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function typeChar(tabId, char) {
  await dispatch(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: char });
  await dispatch(tabId, "Input.dispatchKeyEvent", {
    type: "char",
    key: char,
    text: char,
    unmodifiedText: char,
  });
  await dispatch(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: char });
}

async function clickAt(tabId, x, y) {
  const point = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  await dispatch(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await dispatch(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, buttons: 1 });
  await dispatch(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, buttons: 0 });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith("owa-keys.")) return;
  const tabId = message.tabId || sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: "No tab to type into." });
    return;
  }
  handle(tabId, message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

async function handle(tabId, message) {
  if (message.type === "owa-keys.attach") {
    await attach(tabId);
    return;
  }
  if (message.type === "owa-keys.detach") {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      /* already detached, or the user dismissed the banner */
    }
    return;
  }
  if (message.type === "owa-keys.char") {
    await typeChar(tabId, String(message.char || ""));
    return;
  }
  if (message.type === "owa-keys.paste") {
    await dispatch(tabId, "Input.insertText", { text: String(message.text || "") });
    return;
  }
  if (message.type === "owa-keys.chord") {
    await chord(tabId, message.name);
    return;
  }
  if (message.type === "owa-keys.click") {
    await clickAt(tabId, Number(message.x), Number(message.y));
  }
}
