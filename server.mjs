import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createApi } from "./server/api.mjs";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const appId = "h12-821-practice";
const rootId = createHash("sha256")
  .update(path.resolve(appDirectory).toLowerCase(), "utf8")
  .digest("hex");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".pdf", "application/pdf"],
]);

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function sendText(response, status, message, isHead = false) {
  const body = Buffer.from(message, "utf8");
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(isHead ? undefined : body);
}

export async function createPracticeServer(options = {}) {
  const distDirectory =
    options.distDirectory || path.join(appDirectory, "dist");
  const realDistDirectory = await realpath(distDirectory);
  try {
    const indexPath = await realpath(path.join(distDirectory, "index.html"));
    if (
      !isWithin(realDistDirectory, indexPath) ||
      !(await stat(indexPath)).isFile()
    ) {
      throw new Error("Invalid dist/index.html");
    }
  } catch {
    throw new Error(
      "Built app missing: run npm run build to create dist/index.html.",
    );
  }
  const api = await createApi({
    directory:
      options.dataDirectory ||
      process.env.HCIP_DATA_DIR ||
      path.join(appDirectory, "data"),
    bank: JSON.parse(
      await readFile(path.join(distDirectory, "bank.json"), "utf8"),
    ),
    publicOrigin: options.publicOrigin,
    trustProxy: options.trustProxy,
  });

  const server = http.createServer(async (request, response) => {
    const isHead = request.method === "HEAD";
    if (
      !request.url?.startsWith("/api/") &&
      request.method !== "GET" &&
      !isHead
    ) {
      response.setHeader("Allow", "GET, HEAD");
      return sendText(response, 405, "Method not allowed.", isHead);
    }

    let pathname;
    try {
      pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    } catch {
      return sendText(response, 400, "Invalid URL.", isHead);
    }
    if (
      !pathname.startsWith("/") ||
      pathname.includes("\0") ||
      pathname.includes("\\") ||
      pathname.split("/").includes("..")
    ) {
      return sendText(response, 403, "Invalid path.", isHead);
    }
    if (pathname.startsWith("/api/"))
      return api.handle(request, response, pathname);

    if (pathname === "/health") {
      const address = server.address();
      const body = Buffer.from(
        JSON.stringify({
          app: appId,
          version: 1,
          backendVersion: 2,
          rootId,
          port: address?.port,
          host: address?.address,
        }),
      );
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.byteLength,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return response.end(isHead ? undefined : body);
    }

    let target = path.resolve(distDirectory, `.${pathname}`);
    if (!isWithin(distDirectory, target))
      return sendText(response, 403, "Invalid path.", isHead);

    try {
      let fileInfo;
      try {
        fileInfo = await stat(target);
        if (fileInfo.isDirectory()) {
          target = path.join(target, "index.html");
          fileInfo = await stat(target);
        }
      } catch (error) {
        // Missing assets stay 404; extensionless client-side routes load the app.
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        if (path.extname(pathname) || pathname.startsWith("/api/")) {
          return sendText(response, 404, "Not found.", isHead);
        }
        target = path.join(distDirectory, "index.html");
        fileInfo = await stat(target);
      }

      const realTarget = await realpath(target);
      if (!isWithin(realDistDirectory, realTarget))
        return sendText(response, 403, "Invalid path.", isHead);
      if (!fileInfo.isFile())
        return sendText(response, 404, "Not found.", isHead);

      response.writeHead(200, {
        "Content-Type":
          mimeTypes.get(path.extname(realTarget).toLowerCase()) ||
          "application/octet-stream",
        "Content-Length": fileInfo.size,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (isHead) return response.end();
      const stream = createReadStream(realTarget);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent)
        sendText(response, 500, "Unable to read app file.", isHead);
      else response.destroy();
    }
  });
  return {
    server,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await api.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--host",
        "--port",
        "--data-dir",
        "--public-origin",
        "--trust-proxy",
      ].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        "Usage: node server.mjs [--host 0.0.0.0] [--port 8210] [--data-dir ./data] [--public-origin https://example.com] [--trust-proxy true]",
      );
    values[args[i]] = args[i + 1];
  }
  const port = Number(values["--port"] || process.env.PORT || 8210);
  const bindHost = values["--host"] || process.env.HOST || "127.0.0.1";
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-zA-Z0-9.:%-]+$/.test(bindHost)
  )
    throw new Error("Invalid host or port.");
  const publicOrigin =
    values["--public-origin"] || process.env.HCIP_PUBLIC_ORIGIN;
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin)
    throw new Error(
      "Public origin must contain only scheme and hostname/port, with no trailing slash.",
    );
  const app = await createPracticeServer({
    dataDirectory: values["--data-dir"],
    publicOrigin,
    trustProxy:
      (values["--trust-proxy"] || process.env.HCIP_TRUST_PROXY) === "true",
  });
  app.server.on("error", async (error) => {
    console.error(`Server failed: ${error.message}`);
    await app.close();
    process.exit(1);
  });
  app.server.listen(port, bindHost, () =>
    console.log(
      `H12-821 practice ready at http://${bindHost}:${port}/ (backend enabled)`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void app.close().then(() => process.exit(0)));
}
