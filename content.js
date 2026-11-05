(() => {
  if (!window.__owaBulkAdd) {
    window.__owaBulkAdd = {
      abort: false,
      state: {
        running: false,
        current: 0,
        total: 0,
        name: "",
        added: [],
        skipped: [],
        failed: [],
        message: "",
        log: [],
      },
    };
  }

  const bus = window.__owaBulkAdd;

  function norm(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/[^a-zа-я0-9@.\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokensOf(name) {
    return norm(name).split(" ").filter((token) => token.length >= 2);
  }

  function nameHits(text, name) {
    const tokens = tokensOf(name);
    const haystack = norm(text);
    if (!tokens.length || !haystack.includes(tokens[0])) return 0;
    return tokens.filter((token) => haystack.includes(token)).length;
  }

  function isGoodMatch(text, name) {
    const tokens = tokensOf(name);
    const hits = nameHits(text, name);
    if (!tokens.length) return false;
    return tokens.length === 1 ? hits >= 1 : hits >= 2;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function findAddPeopleInput() {
    const selectors = [
      'input[aria-label="Добавьте людей"]',
      'input[aria-label="Add people"]',
      'input[aria-label="Add attendees"]',
      'input[aria-label="Add required attendees"]',
      'input[autoid="_fp_0"]',
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return [...document.querySelectorAll("input[role='textbox'], input.textbox")].find((el) => {
      if (!isVisible(el)) return false;
      return /людей|people|attendee/i.test(el.getAttribute("aria-label") || "");
    }) || null;
  }

  function attendeeRows() {
    return [...document.querySelectorAll('[autoid="_cm_g"]')];
  }

  function attendeeCount() {
    return attendeeRows().length;
  }

  function alreadyListed(name) {
    return attendeeRows().some((row) => isGoodMatch(row.textContent, name));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function frameOffset() {
    let x = 0;
    let y = 0;
    let view = window;
    while (view !== view.top) {
      const frame = view.frameElement;
      if (!frame) break;
      const rect = frame.getBoundingClientRect();
      x += rect.left;
      y += rect.top;
      view = view.parent;
    }
    return { x, y };
  }

  async function keys(type, payload) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type, ...payload });
    } catch (error) {
      throw new Error(error?.message || "Reload the extension, then start again.");
    }
    if (!response?.ok) {
      throw new Error(response?.error || "Outlook did not accept the keystroke. Reload the extension.");
    }
  }

  function pointOf(el) {
    const rect = el.getBoundingClientRect();
    const frame = frameOffset();
    return {
      x: Math.round(rect.left + Math.min(Math.max(rect.width / 2, 8), 180) + frame.x),
      y: Math.round(rect.top + Math.min(Math.max(rect.height / 2, 6), 22) + frame.y),
    };
  }

  async function realClick(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    await sleep(40);
    const point = pointOf(el);
    await keys("owa-keys.click", point);
  }

  async function prepareField(input) {
    await realClick(input);
    await sleep(70);
    await keys("owa-keys.chord", { name: "escape" });
    await sleep(40);
    await realClick(input);
    await sleep(70);
    await keys("owa-keys.chord", { name: "selectAll" });
    await keys("owa-keys.chord", { name: "backspace" });
    await sleep(40);
    const leftover = Math.min((input.value || "").length + 1, 80);
    for (let index = 0; index < leftover && input.value; index += 1) {
      if (bus.abort) return;
      await keys("owa-keys.chord", { name: "backspace" });
    }
  }

  async function pasteName(input, text) {
    await keys("owa-keys.paste", { text });
    await sleep(120);
    await realClick(input);
    await sleep(60);
    const last = Array.from(text).pop();
    if (!last) return;
    await keys("owa-keys.chord", { name: "backspace" });
    await sleep(40);
    await keys("owa-keys.char", { char: last });
  }

  function rowText(el) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function ownText(el) {
    return [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nearInput(el, input) {
    if (!input || !el) return true;
    const box = el.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    const below = box.bottom >= field.top - 8 && box.top <= field.bottom + 480;
    const aligned = Math.abs(box.left + box.width / 2 - (field.left + field.width / 2)) < 420;
    return below && aligned;
  }

  function isCalendarNoise(text) {
    return /(понедельник|вторник|сред[аы]|четверг|пятниц|суббот|воскресень|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text);
  }

  function emailCount(text) {
    return (String(text).match(/[^\s@]+@[^\s@]+/g) || []).length;
  }

  function widenRow(el, stopAt) {
    let row = el;
    while (row.parentElement && row.parentElement !== stopAt) {
      const parentText = rowText(row.parentElement);
      if (emailCount(parentText) !== 1 || parentText.length > 240) break;
      row = row.parentElement;
    }
    return row;
  }

  function contactRows(popup) {
    const seeds = [...popup.querySelectorAll("div, li, button, a, span")].filter((el) => {
      if (!isVisible(el) || el.closest('[autoid="_cm_g"]')) return false;
      const text = rowText(el);
      if (!/@/.test(text) || text.length > 200 || isCalendarNoise(text)) return false;
      return ![...el.children].some((child) => /@/.test(child.innerText || ""));
    });
    const seen = new Set();
    const rows = [];
    for (const seed of seeds) {
      const row = widenRow(seed, popup);
      if (seen.has(row)) continue;
      seen.add(row);
      const text = rowText(row);
      if (!text || isCalendarNoise(text)) continue;
      rows.push({ el: row, text });
    }
    return rows;
  }

  function findPeoplePopup(input) {
    const header = /^(предлагаемые контакты|suggested contacts|suggestions)$/i;
    const labels = [...document.querySelectorAll("div, span, label, p, strong")].filter((el) => {
      return isVisible(el) && header.test(ownText(el)) && nearInput(el, input);
    });
    if (!labels.length) return null;
    let node = labels[0];
    let best = node.parentElement || node;
    for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
      node = node.parentElement;
      if (!isVisible(node)) break;
      const text = node.innerText || "";
      if (text.length > 1800) break;
      if (emailCount(text) >= 1 && nearInput(node, input)) best = node;
      if (emailCount(text) >= 2) break;
    }
    return best;
  }

  function findPositionedPeopleMenu(input) {
    const menus = [...document.querySelectorAll("div")].filter((el) => {
      if (!isVisible(el) || !nearInput(el, input)) return false;
      const style = getComputedStyle(el);
      const floating = style.position === "absolute" || style.position === "fixed" || el.getAttribute("ispopup") === "1";
      if (!floating) return false;
      const text = el.innerText || "";
      return /@/.test(text) && text.length < 1800 && !isCalendarNoise(text);
    });
    menus.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    });
    return menus[0] || null;
  }

  function collectSuggestions(input) {
    const popup = findPeoplePopup(input) || findPositionedPeopleMenu(input);
    if (!popup) return [];
    return contactRows(popup);
  }

  function fieldHasName(input, name) {
    const value = norm(input.value);
    const surname = tokensOf(name)[0];
    return !!surname && value.includes(surname);
  }

  async function waitForSuggestion(name, input, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (bus.abort) return null;
      if (fieldHasName(input, name)) {
        const ranked = collectSuggestions(input)
          .map((item, index) => ({ ...item, index, hits: nameHits(item.text, name) }))
          .filter((item) => isGoodMatch(item.text, name))
          .sort((a, b) => b.hits - a.hits || a.index - b.index);
        if (ranked.length) return ranked[0];
      }
      await sleep(140);
    }
    return null;
  }

  async function waitUntilAdded(before, name, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (bus.abort) return false;
      if (attendeeCount() > before || alreadyListed(name)) return true;
      await sleep(80);
    }
    return attendeeCount() > before || alreadyListed(name);
  }

  async function chooseSuggestion(item, input, before, name) {
    await realClick(item.el);
    if (await waitUntilAdded(before, name, 1600)) return true;
    const rows = collectSuggestions(input);
    if (rows[0]?.el === item.el) {
      await realClick(input);
      await keys("owa-keys.chord", { name: "enter" });
      if (await waitUntilAdded(before, name, 1200)) return true;
    }
    return false;
  }

  function log(text, kind) {
    bus.state.log.push({ text, kind: kind || "" });
    if (bus.state.log.length > 12) bus.state.log.splice(0, bus.state.log.length - 12);
    renderPanel();
  }

  function publicStatus() {
    const state = bus.state;
    return {
      running: state.running,
      hasField: !!findAddPeopleInput(),
      current: state.current,
      total: state.total,
      name: state.name,
      added: state.added.slice(),
      skipped: state.skipped.slice(),
      failed: state.failed.slice(),
      message: state.message,
      log: state.log.slice(-8),
    };
  }

  function renderPanel() {
    const host = document.getElementById("owa-bulk-add-host");
    if (!host?.shadowRoot) return;
    const root = host.shadowRoot;
    const state = bus.state;
    const title = root.getElementById("title");
    const detail = root.getElementById("detail");
    const lines = root.getElementById("lines");
    const stop = root.getElementById("stop");
    if (state.running) {
      title.textContent = `${state.current} / ${state.total}`;
      detail.textContent = state.name ? `${state.message}: ${state.name}` : state.message;
    } else if (state.total) {
      title.textContent = state.message || "Done";
      detail.textContent = `Added ${state.added.length}, skipped ${state.skipped.length}, failed ${state.failed.length}.`;
    }
    stop.hidden = false;
    stop.textContent = state.running ? "Stop" : "Close";
    const report = !state.running && state.total
      ? [
          ...state.failed.map((name) => ({ text: `Failed: ${name}`, kind: "bad" })),
          ...state.skipped.map((name) => ({ text: `Skipped: ${name}`, kind: "" })),
        ]
      : state.log.slice(-6);
    const shown = report.length || state.running
      ? report
      : [{ text: "None failed or skipped.", kind: "ok" }];
    lines.replaceChildren();
    for (const line of state.total && !state.running ? shown : report) {
      const row = document.createElement("div");
      row.textContent = line.text;
      if (line.kind === "bad") row.style.color = "#a4262c";
      if (line.kind === "ok") row.style.color = "#0b6a0b";
      lines.appendChild(row);
    }
    const copy = ensureCopyBox(root);
    const problematic = !state.running && state.total
      ? [...state.failed, ...state.skipped].join("; ")
      : "";
    copy.value = problematic;
    copy.hidden = !problematic;
    root.getElementById("copyLabel").hidden = !problematic;
  }

  function ensureCopyBox(root) {
    let box = root.getElementById("copy");
    if (box) return box;
    const label = document.createElement("div");
    label.id = "copyLabel";
    label.textContent = "Copy these";
    label.style.cssText = "margin-top:6px;color:#605e5c;font-size:12px;";
    box = document.createElement("textarea");
    box.id = "copy";
    box.readOnly = true;
    box.rows = 4;
    box.spellcheck = false;
    box.style.cssText = "width:100%;box-sizing:border-box;margin-top:4px;font:12px/1.4 Consolas,Segoe UI,sans-serif;padding:6px;border:1px solid #c8c6c4;border-radius:4px;resize:vertical;color:#1b1a19;background:#fff;";
    box.addEventListener("focus", () => box.select());
    box.addEventListener("click", () => box.select());
    root.querySelector(".card").append(label, box);
    return box;
  }

  function ensurePanel() {
    let host = document.getElementById("owa-bulk-add-host");
    if (host) return host;
    host = document.createElement("div");
    host.id = "owa-bulk-add-host";
    host.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:340px;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .card { font: 13px/1.35 "Segoe UI", sans-serif; background: #fff; color: #1b1a19;
          border: 1px solid #c8c6c4; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 10px 12px; }
        .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
        strong { font-size: 13px; }
        button { border: 1px solid #c8c6c4; background: #fff; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
        #detail { margin: 4px 0 6px; color: #605e5c; word-break: break-word; }
        #lines { max-height: 240px; overflow: auto; font-size: 12px; color: #605e5c; }
        #lines div { margin: 2px 0; word-break: break-word; }
      </style>
      <div class="card">
        <div class="top"><strong id="title">Participants</strong><button id="stop" type="button">Stop</button></div>
        <div id="detail"></div>
        <div id="lines"></div>
      </div>`;
    shadow.getElementById("stop").addEventListener("click", () => {
      if (bus.state.running) window.__owaBulkAddStop();
      else host.remove();
    });
    document.documentElement.appendChild(host);
    return host;
  }

  async function runPass(list, pauseMs, label) {
    bus.state.total = list.length;
    for (let index = 0; index < list.length; index += 1) {
      if (bus.abort) {
        bus.state.message = "Stopped";
        return { failed: bus.state.failed.slice(), skipped: bus.state.skipped.slice(), reason: "stopped" };
      }
      const name = list[index];
      bus.state.current = index + 1;
      bus.state.name = name;
      bus.state.message = label;
      const input = findAddPeopleInput();
      if (!input) {
        bus.state.failed.push(name);
        bus.state.message = "Field lost";
        log("Field «Добавьте людей» disappeared.", "bad");
        return { failed: bus.state.failed.slice(), skipped: bus.state.skipped.slice(), reason: "lost" };
      }
      if (alreadyListed(name)) {
        bus.state.skipped.push(name);
        log(`Skipped, already on the list: ${name}`);
        renderPanel();
        continue;
      }

      renderPanel();
      await prepareField(input);
      if (bus.abort) {
        bus.state.message = "Stopped";
        return { failed: bus.state.failed.slice(), skipped: bus.state.skipped.slice(), reason: "stopped" };
      }
      await pasteName(input, name);

      bus.state.message = `${label}, waiting`;
      renderPanel();
      const item = await waitForSuggestion(name, input, 7000);
      if (bus.abort) {
        bus.state.message = "Stopped";
        return { failed: bus.state.failed.slice(), skipped: bus.state.skipped.slice(), reason: "stopped" };
      }
      if (!item) {
        const typed = input.value.trim();
        const seen = collectSuggestions(input).map((entry) => entry.text).slice(0, 3);
        bus.state.failed.push(name);
        if (!fieldHasName(input, name)) {
          log(`Failed, paste did not land: ${name}. Field shows “${typed || "empty"}”.`, "bad");
        } else if (seen.length) {
          log(`Failed, no match: ${name}. Saw: ${seen.join(" | ")}`, "bad");
        } else {
          log(`Failed, no people menu: ${name}.`, "bad");
        }
        await prepareField(input);
        await sleep(pauseMs);
        continue;
      }

      bus.state.message = `${label}, clicking`;
      renderPanel();
      const before = attendeeCount();
      const added = await chooseSuggestion(item, input, before, name);
      if (added) {
        bus.state.added.push(name);
        log(`Added: ${name}`, "ok");
      } else {
        bus.state.failed.push(name);
        log(`Failed, suggestion did not stick: ${name}`, "bad");
        await prepareField(input);
      }
      renderPanel();
      await sleep(pauseMs);
    }
    return { failed: bus.state.failed.slice(), skipped: bus.state.skipped.slice(), reason: "done" };
  }

  async function run(names, options) {
    const pauseMs = Math.min(5000, Math.max(200, Number(options?.pauseMs) || 600));
    bus.abort = false;
    bus.state = {
      running: true,
      current: 0,
      total: names.length,
      name: "",
      added: [],
      skipped: [],
      failed: [],
      message: "Starting",
      log: [],
    };
    ensurePanel();
    renderPanel();

    try {
      await keys("owa-keys.attach");
      log("Pasting each name, then the last letter.");
      const first = await runPass(names, pauseMs, "Adding");
      const again = [...first.failed, ...first.skipped];
      if (!bus.abort && first.reason !== "lost" && again.length) {
        log(`Left over: ${again.join("; ")}`, "bad");
        log(`Running ${again.length} again.`);
        bus.state.failed = [];
        bus.state.skipped = [];
        await runPass(again, pauseMs, "Retrying");
        if (bus.abort) {
          const settled = new Set([...bus.state.added, ...bus.state.failed, ...bus.state.skipped]);
          for (const name of again) {
            if (!settled.has(name)) bus.state.failed.push(name);
          }
        }
      }
    } catch (error) {
      bus.state.message = "Error";
      log(error?.message || String(error), "bad");
    } finally {
      bus.state.running = false;
      if (bus.abort) bus.state.message = "Stopped";
      else if (bus.state.message !== "Field lost" && bus.state.message !== "Error") bus.state.message = "Done";
      bus.abort = false;
      renderPanel();
      try {
        await keys("owa-keys.detach");
      } catch {
        /* Banner already closed. */
      }
    }
  }

  function findTitleInput() {
    const selectors = [
      'input[aria-label="Добавьте название события"]',
      'input[aria-label="Add a title"]',
      'input[aria-label="Add title"]',
      'input[aria-label="Add an event title"]',
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return [...document.querySelectorAll("input[role='textbox']")].find((el) => {
      if (!isVisible(el) || el.getAttribute("autoid") === "_lw_0") return false;
      return /название события|event title|add a title|add title/i.test(el.getAttribute("aria-label") || "");
    }) || null;
  }

  function findLocationInput() {
    const selectors = [
      'input[autoid="_lw_0"]',
      'input[aria-labelledby="MeetingCompose.LocationInputLabel"]',
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return null;
  }

  function findEventBody() {
    const selectors = [
      '[contenteditable="true"][aria-label="Тело события"]',
      '[contenteditable="true"][aria-label="Event body"]',
      '[contenteditable="true"][aria-label="Message body"]',
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].find((el) => {
      if (!isVisible(el)) return false;
      return /тело события|event body|message body/i.test(el.getAttribute("aria-label") || "");
    }) || null;
  }

  function focusLanded(el) {
    const active = document.activeElement;
    return active === el || (!!active && el.contains(active));
  }

  async function replaceControl(el, text) {
    await realClick(el);
    await sleep(90);
    if (!focusLanded(el)) {
      el.focus();
      await sleep(40);
    }
    if (focusLanded(el)) {
      await keys("owa-keys.chord", { name: "selectAll" });
      await keys("owa-keys.chord", { name: "backspace" });
      await sleep(40);
    }
    if (text) await keys("owa-keys.paste", { text });
    await sleep(80);
    if (el.tagName === "INPUT" && text && !(el.value || "").includes(text.slice(0, Math.min(8, text.length)))) {
      if (focusLanded(el)) {
        await keys("owa-keys.chord", { name: "selectAll" });
        await keys("owa-keys.chord", { name: "backspace" });
      }
      for (const char of Array.from(text)) await keys("owa-keys.char", { char });
    }
  }

  window.__owaFillMeeting = async (details) => {
    if (bus.state.running) return { ok: false, reason: "busy" };
    const titleInput = details?.title ? findTitleInput() : null;
    const locationInput = details?.place ? findLocationInput() : null;
    const body = details?.body ? findEventBody() : null;
    if (!titleInput && !locationInput && !body) return { ok: false, reason: "no-form" };
    const filled = [];
    const missed = [];
    if (details?.title) (titleInput ? filled : missed).push("title");
    if (details?.place) (locationInput ? filled : missed).push("place");
    if (details?.body) (body ? filled : missed).push("body");
    try {
      await keys("owa-keys.attach");
      if (titleInput) await replaceControl(titleInput, String(details.title));
      if (locationInput) await replaceControl(locationInput, String(details.place).slice(0, 255));
      if (body) await replaceControl(body, String(details.body));
      return { ok: true, filled, missed };
    } catch (error) {
      return { ok: false, reason: "error", error: error?.message || String(error) };
    } finally {
      try {
        await keys("owa-keys.detach");
      } catch {
        /* Banner already closed. */
      }
    }
  };

  window.__owaBulkAddStart = (names, options) => {
    if (!findAddPeopleInput()) return { ok: false, reason: "no-input" };
    if (bus.state.running) return { ok: false, reason: "busy" };
    const list = (names || []).map((name) => String(name).trim()).filter(Boolean);
    if (!list.length) return { ok: false, reason: "empty" };
    run(list, options);
    return { ok: true, total: list.length };
  };

  window.__owaBulkAddStop = () => {
    if (!bus.state.running) return { ok: true };
    bus.abort = true;
    bus.state.message = "Stopping";
    renderPanel();
    return { ok: true };
  };

  window.__owaBulkAddStatus = () => publicStatus();
})();
