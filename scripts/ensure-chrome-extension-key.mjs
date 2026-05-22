import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = ".env";
const env = loadDotEnv(envPath);
let publicKey = process.env.CHROME_EXTENSION_PUBLIC_KEY ?? env.CHROME_EXTENSION_PUBLIC_KEY;

if (!publicKey) {
  const keyPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      format: "der",
      type: "spki",
    },
  });
  publicKey = keyPair.publicKey.toString("base64");
  appendDotEnv(envPath, "CHROME_EXTENSION_PUBLIC_KEY", publicKey);
  console.log("Generated CHROME_EXTENSION_PUBLIC_KEY in .env.");
}

console.log(`Chrome extension ID: ${deriveChromeExtensionId(publicKey)}`);

function deriveChromeExtensionId(base64PublicKey) {
  const digest = crypto.createHash("sha256").update(Buffer.from(base64PublicKey, "base64")).digest();
  const alphabet = "abcdefghijklmnop";
  let id = "";
  for (const byte of digest.subarray(0, 16)) {
    id += alphabet[byte >> 4];
    id += alphabet[byte & 0x0f];
  }
  return id;
}

function appendDotEnv(path, key, value) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${key}=${value}\n`;
  writeFileSync(path, next);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}
