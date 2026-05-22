type BrowserExtensionSnapshot = {
  buttons?: string[];
  capturedAt?: string;
  forms?: {
    action?: string;
    fields?: string[];
    method?: string;
  }[];
  links?: {
    href?: string;
    text?: string;
  }[];
  selectedText?: string;
  title?: string;
  url?: string;
  visibleText?: string;
};

const EXTENSION_SNAPSHOT_PARAM = "extensionSnapshot";

export function consumeBrowserExtensionSnapshotPrompt() {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(EXTENSION_SNAPSHOT_PARAM);
  if (!encoded) return null;

  url.searchParams.delete(EXTENSION_SNAPSHOT_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

  const snapshot = decodeSnapshot(encoded);
  if (!snapshot) return null;

  return formatSnapshotPrompt(snapshot);
}

function decodeSnapshot(encoded: string): BrowserExtensionSnapshot | null {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as BrowserExtensionSnapshot;
  } catch {
    return null;
  }
}

function formatSnapshotPrompt(snapshot: BrowserExtensionSnapshot) {
  const buttons = (snapshot.buttons ?? []).slice(0, 10).join(", ") || "None detected";
  const forms =
    snapshot.forms
      ?.slice(0, 5)
      .map((form) => `${form.method ?? "GET"} ${form.action ?? ""} fields=${(form.fields ?? []).join(", ")}`)
      .join("\n") || "None detected";
  const links =
    snapshot.links
      ?.slice(0, 8)
      .map((link) => `${link.text ?? "link"} -> ${link.href ?? ""}`)
      .join("\n") || "None captured";
  const text = snapshot.selectedText || snapshot.visibleText || "";

  return [
    "Review this browser page for wallet-agent safety and debugging.",
    `Title: ${snapshot.title ?? "Untitled"}`,
    `URL: ${snapshot.url ?? "Unknown"}`,
    `Captured at: ${snapshot.capturedAt ?? "Unknown"}`,
    `Buttons: ${buttons}`,
    `Forms:\n${forms}`,
    `Links:\n${links}`,
    `Visible text excerpt:\n${text.slice(0, 2200)}`,
    "Return the concrete risk, what the user should verify, and whether a wallet intent can be prepared.",
  ].join("\n\n");
}
