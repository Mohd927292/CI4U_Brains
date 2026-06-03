import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const webUrl = (process.env.CI4U_SMOKE_WEB_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const chromePath = process.env.CI4U_CHROME_PATH ?? findChromePath();
const screenshotPath = process.env.CI4U_SMOKE_SCREENSHOT_PATH ?? path.join(os.tmpdir(), "ci4u-web-smoke.png");
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "ci4u-chrome-"));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  {
    stdio: ["ignore", "ignore", "pipe"],
  },
);

try {
  const browserWsUrl = await readDevtoolsUrl(chrome);
  const browser = await createCdpClient(browserWsUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

  const page = {
    send: (method, params = {}) => browser.send(method, params, sessionId),
  };
  const consoleErrors = [];

  browser.onMessage = (message) => {
    if (message.sessionId !== sessionId) {
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(message.params?.exceptionDetails?.text ?? "Runtime exception");
    }

    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      consoleErrors.push(message.params.entry.text);
    }
  };

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Page.setViewport", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false }).catch(() => undefined);
  await page.send("Page.navigate", { url: webUrl });

  await waitForText(page, "CI4U Brains Dev Login", 15000);
  await clickButtonContaining(page, "Rahul Verma");
  await waitForText(page, "Operations Command", 15000);
  await waitForText(page, "Open Raw Leads", 15000);
  await clickButtonByTitle(page, "Hide sidebar");
  await waitForText(page, "Operations Command", 15000);
  await clickButtonByTitle(page, "Show sidebar");
  await waitForText(page, "Operations Command", 15000);

  await clickButtonContaining(page, "Open Raw Leads");
  await waitForText(page, "Manual Raw Lead", 15000);

  const unique = String(Date.now()).slice(-9);
  const customerName = `UI Smoke ${unique}`;
  const phone = `9${unique}`;
  const nextCustomerName = `UI Smoke Next ${unique}`;
  const nextPhone = `8${unique}`;

  await setRawLeadForm(page, customerName, phone);
  await clickButtonContaining(page, "Create Raw Lead");
  await waitForText(page, "Raw lead created", 15000);
  await waitForText(page, customerName, 15000);
  await setRawLeadForm(page, nextCustomerName, nextPhone);
  await clickButtonContaining(page, "Create Raw Lead");
  await waitForText(page, nextCustomerName, 15000);

  await clickOpenForCustomer(page, customerName);
  await waitForText(page, `${customerName} - +91${phone}`, 15000);
  await waitForText(page, "Raw Lead First Call", 15000);

  await setLeadCallUpdate(page, {
    callOutcome: "WARM",
    conversationSummary: "Customer is interested but wants a later CCTV follow-up.",
  });
  await clickButtonContaining(page, "Generate WhatsApp Draft");
  await waitForTextareaValue(page, "Next step: nurture", 15000);
  const saveStartedAt = Date.now();
  await clickButtonContaining(page, "Save Lead Update");
  await waitForText(page, `${nextCustomerName} - +91${nextPhone}`, 15000);
  const handoffMs = Date.now() - saveStartedAt;
  await waitForText(page, "Workflow progress", 15000);

  const screenshot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  if (consoleErrors.length) {
    throw new Error(`Browser console/runtime errors detected: ${consoleErrors.join(" | ")}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        webUrl,
        handoffMs,
        checked: ["dev login", "dashboard", "sidebar toggle-ready layout", "manual raw leads", "lead detail", "warm background save", "instant next-lead handoff", "whatsapp draft"],
        screenshotPath,
      },
      null,
      2,
    ),
  );
} finally {
  chrome.kill();
  await fs.rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

function findChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const candidate of candidates) {
    try {
      const stat = requireStat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next browser path.
    }
  }

  throw new Error("Could not find Chrome or Edge. Set CI4U_CHROME_PATH to a Chromium executable.");
}

function requireStat(filePath) {
  return fsSync.statSync(filePath);
}

async function readDevtoolsUrl(child) {
  let buffer = "";

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not expose a DevTools WebSocket URL.")), 15000);

    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);

      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready. Exit code: ${code ?? "unknown"}`));
    });
  });
}

async function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  let onMessage = () => undefined;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result ?? {});
      }

      return;
    }

    onMessage(message);
  });

  return {
    set onMessage(handler) {
      onMessage = handler;
    },
    send(method, params = {}, sessionId) {
      const id = nextId;
      nextId += 1;
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP command timed out: ${method}`));
          }
        }, 15000);
      });
    },
  };
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed.");
  }

  return result.result?.value;
}

async function waitForText(page, text, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const found = await evaluate(page, `document.body?.innerText.includes(${JSON.stringify(text)})`);

    if (found) {
      return;
    }

    await sleep(250);
  }

  const body = await evaluate(page, "document.body?.innerText.slice(0, 2000)");
  throw new Error(`Timed out waiting for text "${text}". Body starts with: ${body}`);
}

async function clickButtonContaining(page, text) {
  const clicked = await evaluate(
    page,
    `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((element) => element.innerText.includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );

  if (!clicked) {
    throw new Error(`Could not find button containing "${text}".`);
  }
}

async function clickButtonByTitle(page, title) {
  const clicked = await evaluate(
    page,
    `(() => {
      const button = document.querySelector(${JSON.stringify(`button[title="${title}"]`)});
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );

  if (!clicked) {
    throw new Error(`Could not find button titled "${title}".`);
  }
}

async function waitForTextareaValue(page, text, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const found = await evaluate(
      page,
      `Array.from(document.querySelectorAll("textarea")).some((element) => element.value.includes(${JSON.stringify(text)}))`,
    );

    if (found) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for textarea value "${text}".`);
}

async function setRawLeadForm(page, name, phone) {
  await evaluate(
    page,
    `(() => {
      const inputs = Array.from(document.querySelectorAll("input.field"));
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setValue(inputs[0], ${JSON.stringify(name)});
      setValue(inputs[1], ${JSON.stringify(phone)});
      return true;
    })()`,
  );
}

async function clickOpenForCustomer(page, customerName) {
  const clicked = await evaluate(
    page,
    `(() => {
      const row = Array.from(document.querySelectorAll("tr")).find((element) => element.innerText.includes(${JSON.stringify(customerName)}));
      const button = row?.querySelector("button");
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );

  if (!clicked) {
    throw new Error(`Could not open customer row "${customerName}".`);
  }
}

async function setLeadCallUpdate(page, update) {
  await evaluate(
    page,
    `(() => {
      const setSelect = (select, value) => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const setTextarea = (textarea, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      };

      setSelect(document.querySelectorAll("select.field")[0], ${JSON.stringify(update.callOutcome)});
      return new Promise((resolve) => setTimeout(resolve, 0));
    })()`,
  );
  await evaluate(
    page,
    `(() => {
      const setSelect = (select, value) => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const setTextarea = (textarea, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      };

      setTextarea(document.querySelectorAll("textarea.field")[0], ${JSON.stringify(update.conversationSummary)});
      if (${JSON.stringify(Boolean(update.leadIntent))}) {
        setSelect(document.querySelectorAll("select.field")[1], ${JSON.stringify(update.leadIntent ?? "")});
      }
      return true;
    })()`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
