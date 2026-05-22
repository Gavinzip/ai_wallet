import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const rootDir = path.resolve(process.argv[2] ?? process.env.WEB_EXPORT_DIR ?? defaultRoot);
const port = Number(process.env.WEB_EXPORT_PORT ?? 8091);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

if (!fs.existsSync(path.join(rootDir, "index.html"))) {
  console.error(`Missing ${path.join(rootDir, "index.html")}. Run npm run web:export first.`);
  process.exit(1);
}

http
  .createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (shouldRedirectToHttps(request, requestUrl)) {
      response.writeHead(308, {
        Location: `https://${requestUrl.host}${requestUrl.pathname}${requestUrl.search}`,
      });
      response.end();
      return;
    }

    const pathname = decodeURIComponent(requestUrl.pathname);
    const candidate = safeJoin(rootDir, pathname === "/" ? "/index.html" : pathname);

    if (candidate && isReadableFile(candidate)) {
      sendFile(request, response, candidate);
      return;
    }

    if (!path.extname(pathname)) {
      sendFile(request, response, path.join(rootDir, "index.html"));
      return;
    }

    response.writeHead(404, {
      ...getSecurityHeaders(request),
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Expo web export serving ${rootDir} at http://localhost:${port}`);
  });

function safeJoin(root, pathname) {
  const resolved = path.resolve(root, `.${pathname}`);
  return resolved.startsWith(`${root}${path.sep}`) || resolved === root ? resolved : null;
}

function isReadableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sendFile(request, response, filePath) {
  const extension = path.extname(filePath);
  response.writeHead(200, {
    ...getSecurityHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

function shouldRedirectToHttps(request, requestUrl) {
  if (process.env.ENFORCE_HTTPS !== "1") return false;
  if (isLocalHost(requestUrl.hostname)) return false;
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").toLowerCase();
  if (forwardedProto === "https") return false;
  if (forwardedProto === "http") return true;
  return requestUrl.protocol === "http:";
}

function getSecurityHeaders(request) {
  const host = String(request.headers.host ?? "localhost").split(":")[0];
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:8787 http://127.0.0.1:8787 https://accounts.google.com https://www.googleapis.com",
    "form-action 'self'",
  ].join("; ");

  const headers = {
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (!isLocalHost(host) && request.headers["x-forwarded-proto"] === "https") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
