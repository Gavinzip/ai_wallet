chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CAPTURE_ACTIVE_TAB") return false;

  captureActiveTab()
    .then((snapshot) => sendResponse({ ok: true, snapshot }))
    .catch((error) => {
      sendResponse({
        error: error instanceof Error ? error.message : "Failed to capture active tab.",
        ok: false,
      });
    });

  return true;
});

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  const [result] = await chrome.scripting.executeScript({
    func: collectPageSnapshot,
    target: { tabId: tab.id },
  });

  if (!result?.result) {
    throw new Error("The active tab did not return a page snapshot.");
  }

  return result.result;
}

function collectPageSnapshot() {
  const clean = (value, limit = 240) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);

  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit']")]
    .map((element) => clean(element.innerText || element.value || element.getAttribute("aria-label")))
    .filter(Boolean)
    .slice(0, 18);

  const forms = [...document.forms].map((form) => ({
    action: clean(form.action || location.href, 320),
    method: clean(form.method || "get", 20).toUpperCase(),
    fields: [...form.elements]
      .map((field) => clean(field.getAttribute("name") || field.getAttribute("aria-label") || field.id))
      .filter(Boolean)
      .slice(0, 12),
  }));

  const links = [...document.querySelectorAll("a[href]")]
    .map((link) => ({
      href: clean(link.href, 320),
      text: clean(link.innerText || link.getAttribute("aria-label")),
    }))
    .filter((link) => link.href && link.text)
    .slice(0, 18);

  const selectedText = clean(String(window.getSelection?.() ?? ""), 1000);
  const visibleText = clean(document.body?.innerText ?? "", 6000);

  return {
    buttons,
    capturedAt: new Date().toISOString(),
    forms,
    links,
    selectedText,
    title: document.title,
    url: location.href,
    visibleText,
  };
}
