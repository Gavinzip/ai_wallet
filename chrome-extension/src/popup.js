const APP_ORIGIN = "__APP_ORIGIN__";
const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_CHROME_EXTENSION_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

const elements = {
  captureButton: document.getElementById("captureButton"),
  googleButton: document.getElementById("googleButton"),
  googleStatus: document.getElementById("googleStatus"),
  notice: document.getElementById("notice"),
  openAgentButton: document.getElementById("openAgentButton"),
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  snapshotCard: document.getElementById("snapshotCard"),
  tokenCoreButton: document.getElementById("tokenCoreButton"),
  wasmStatus: document.getElementById("wasmStatus"),
};

let latestSnapshot = null;

void restoreState();

elements.googleButton.addEventListener("click", () => {
  void signInWithGoogle();
});

elements.captureButton.addEventListener("click", () => {
  void captureActivePage();
});

elements.tokenCoreButton.addEventListener("click", () => {
  void verifyTokenCoreWasm();
});

elements.openAgentButton.addEventListener("click", () => {
  if (!latestSnapshot) {
    setNotice("Capture a page before opening agent review.");
    return;
  }
  const encoded = encodeBase64Url(JSON.stringify(latestSnapshot));
  chrome.tabs.create({
    url: `${APP_ORIGIN}/agent?extensionSnapshot=${encodeURIComponent(encoded)}`,
  });
});

async function restoreState() {
  const { googleUser, latestPageSnapshot } = await chrome.storage.local.get([
    "googleUser",
    "latestPageSnapshot",
  ]);
  if (googleUser?.email) {
    elements.googleStatus.textContent = googleUser.email;
  }
  if (latestPageSnapshot) {
    renderSnapshot(latestPageSnapshot);
  }
}

async function signInWithGoogle() {
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest.oauth2?.client_id === PLACEHOLDER_CLIENT_ID) {
      throw new Error("Set CHROME_EXTENSION_GOOGLE_CLIENT_ID and rebuild the extension.");
    }

    setNotice("Opening Google approval...");
    const result = await chrome.identity.getAuthToken({
      interactive: true,
      scopes: ["openid", "email", "profile"],
    });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) {
      throw new Error("Chrome identity did not return a Google access token.");
    }

    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Google userinfo failed with HTTP ${response.status}.`);
    }
    const user = await response.json();
    if (!user.email || !user.sub) {
      throw new Error("Google profile is missing email or stable subject.");
    }

    await chrome.storage.local.set({ googleUser: user });
    elements.googleStatus.textContent = user.email;
    setNotice("Google profile connected for extension review context.");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Google login failed.");
  }
}

async function captureActivePage() {
  try {
    setNotice("Capturing active tab...");
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_ACTIVE_TAB" });
    if (!response?.ok) {
      throw new Error(response?.error ?? "Active tab capture failed.");
    }
    await chrome.storage.local.set({ latestPageSnapshot: response.snapshot });
    renderSnapshot(response.snapshot);
    setNotice("Page snapshot captured. Open agent review to debug it.");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Active tab capture failed.");
  }
}

async function verifyTokenCoreWasm() {
  try {
    setNotice("Loading Token Core WASM...");
    const tcx = await import("./vendor/tcx_wasm.js");
    await tcx.default({ module_or_path: chrome.runtime.getURL("tcx_wasm_bg.wasm") });
    elements.wasmStatus.textContent = "Loaded";
    setNotice("Token Core WASM loaded inside the extension package.");
  } catch (error) {
    elements.wasmStatus.textContent = "Failed";
    setNotice(error instanceof Error ? error.message : "Token Core WASM check failed.");
  }
}

function renderSnapshot(snapshot) {
  latestSnapshot = snapshot;
  elements.snapshotCard.hidden = false;
  elements.pageTitle.textContent = snapshot.title || "Untitled page";
  elements.pageUrl.textContent = snapshot.url || "";
}

function setNotice(message) {
  elements.notice.textContent = message;
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
