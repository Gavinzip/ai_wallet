import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceDir = path.join(root, "chrome-extension", "src");
const distDir = path.join(root, "chrome-extension", "dist");
const allowPlaceholder = process.argv.includes("--allow-placeholder");

const env = await loadDotEnv(path.join(root, ".env"));
const chromeClientId = process.env.CHROME_EXTENSION_GOOGLE_CLIENT_ID ?? env.CHROME_EXTENSION_GOOGLE_CLIENT_ID;
const chromePublicKey = process.env.CHROME_EXTENSION_PUBLIC_KEY ?? env.CHROME_EXTENSION_PUBLIC_KEY;
const appOrigin =
  process.env.EXPO_PUBLIC_WALLET_WEB_ORIGIN ??
  env.EXPO_PUBLIC_WALLET_WEB_ORIGIN ??
  "http://localhost:8081";

if (!chromeClientId && !allowPlaceholder) {
  console.error(
    [
      "Missing CHROME_EXTENSION_GOOGLE_CLIENT_ID.",
      "Create a Google OAuth client for a Chrome Extension and put it in .env as:",
      "CHROME_EXTENSION_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com",
      "For UI-only local packaging, run: npm run extension:dev",
    ].join("\n"),
  );
  process.exit(1);
}

await rm(distDir, { force: true, recursive: true });
await mkdir(distDir, { recursive: true });
await copyTemplateTree(sourceDir, distDir, {
  __EXTENSION_KEY_BLOCK__: chromePublicKey ? `"key": "${chromePublicKey}",` : "",
  __APP_ORIGIN__: appOrigin,
  __GOOGLE_CLIENT_ID__: chromeClientId ?? "REPLACE_WITH_CHROME_EXTENSION_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
});
await copyTokenCoreWasm();

console.log(`Chrome extension written to ${path.relative(root, distDir)}`);
if (!chromeClientId) {
  console.log("Google login is disabled until CHROME_EXTENSION_GOOGLE_CLIENT_ID is set.");
}

async function copyTemplateTree(fromDir, toDir, replacements) {
  const entries = await readdir(fromDir);
  await mkdir(toDir, { recursive: true });

  for (const entry of entries) {
    const fromPath = path.join(fromDir, entry);
    const toPath = path.join(toDir, entry === "manifest.template.json" ? "manifest.json" : entry);
    const info = await stat(fromPath);

    if (info.isDirectory()) {
      await copyTemplateTree(fromPath, toPath, replacements);
      continue;
    }

    const extension = path.extname(fromPath);
    if ([".css", ".html", ".js", ".json", ".md"].includes(extension)) {
      let content = await readFile(fromPath, "utf8");
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
      }
      await writeFile(toPath, content);
      continue;
    }

    await copyFile(fromPath, toPath);
  }
}

async function copyTokenCoreWasm() {
  const vendorDir = path.join(distDir, "vendor");
  await mkdir(vendorDir, { recursive: true });
  await copyFile(
    path.join(root, "node_modules", "@consenlabs", "tcx-wasm", "tcx_wasm.js"),
    path.join(vendorDir, "tcx_wasm.js"),
  );
  await copyFile(
    path.join(root, "node_modules", "@consenlabs", "tcx-wasm", "tcx_wasm_bg.wasm"),
    path.join(distDir, "tcx_wasm_bg.wasm"),
  );
}

async function loadDotEnv(dotEnvPath) {
  try {
    const raw = await readFile(dotEnvPath, "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}
