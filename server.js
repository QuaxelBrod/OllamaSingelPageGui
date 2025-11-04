"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 4173;
const ROOT_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

const isProduction = process.env.NODE_ENV === "production";

const TARGET_HEADER = "x-ollama-server";
const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type, X-Ollama-Server, Authorization";

const server = http.createServer(async (req, res) => {
  try {
    const { method = "GET" } = req;
    const originalPath = (req.url || "/").split("?")[0] || "/";
    const requestPath = sanitizePath(req.url || "/");

    if (method === "OPTIONS") {
      res.writeHead(204, buildCorsHeaders());
      res.end();
      return;
    }

    if (isOllamaRoute(originalPath)) {
      await proxyOllamaRequest(req, res);
      return;
    }

    if (requestPath === "api/default-server") {
      const body = JSON.stringify({
        defaultServer:
          normalizeServerUrl(process.env.DEFAULT_SERVER) || "http://localhost:11434",
      });
      res.writeHead(
        200,
        buildCorsHeaders({
          "Content-Type": "application/json",
        })
      );
      res.end(body);
      return;
    }

    const resolvedPath = path.resolve(ROOT_DIR, requestPath);

    if (!resolvedPath.startsWith(ROOT_DIR)) {
      res.writeHead(403, buildCorsHeaders({ "Content-Type": "text/plain" }));
      res.end("Forbidden");
      return;
    }

    let filePath = resolvedPath;
    let fallbackToIndex = false;

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch (error) {
      fallbackToIndex = shouldServeIndex(requestPath);
      if (!fallbackToIndex) {
        throw error;
      }
    }

    if (fallbackToIndex) {
      filePath = path.join(ROOT_DIR, "index.html");
    }

    const payload = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, buildHeaders(mimeType));
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(payload);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      res.writeHead(404, buildCorsHeaders({ "Content-Type": "text/plain" }));
      res.end("Not Found");
      return;
    }

    console.error("Server error:", error);
    res.writeHead(500, buildCorsHeaders({ "Content-Type": "text/plain" }));
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server ready at http://${HOST}:${PORT}`);
});

function sanitizePath(urlPath) {
  try {
    const cleaned = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
    const stripped = cleaned.replace(/^\/+/, "");
    if (!stripped) {
      return "index.html";
    }
    return stripped;
  } catch (error) {
    return "index.html";
  }
}

function isOllamaRoute(pathname) {
  if (!pathname) return false;
  return pathname === "/ollama" || pathname.startsWith("/ollama/");
}

function shouldServeIndex(requestPath) {
  return !path.extname(requestPath);
}

function buildHeaders(mimeType) {
  const headers = buildCorsHeaders({
    "Content-Type": mimeType,
  });

  if (isProduction) {
    headers["Cache-Control"] = "public, max-age=3600";
  } else {
    headers["Cache-Control"] = "no-store";
  }

  return headers;
}

function buildCorsHeaders(additional = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    ...additional,
  };
}

function normalizeServerUrl(url) {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

async function proxyOllamaRequest(req, res) {
  const corsHeaders = buildCorsHeaders();
  const method = req.method || "GET";

  const originalUrl = new URL(req.url, `${req.protocol || "http"}://${req.headers.host || "localhost"}`);
  let pathname = originalUrl.pathname.replace(/^\/?ollama/, "");
  if (!pathname.startsWith("/")) {
    pathname = `/${pathname}`;
  }

  const headerValue = Array.isArray(req.headers[TARGET_HEADER])
    ? req.headers[TARGET_HEADER][0]
    : req.headers[TARGET_HEADER];

  const targetBase =
    normalizeServerUrl(headerValue) ||
    normalizeServerUrl(process.env.DEFAULT_SERVER) ||
    "http://localhost:11434";

  let targetUrl;
  try {
    targetUrl = new URL(`${pathname}${originalUrl.search}`, ensureProtocol(targetBase));
  } catch (error) {
    res.writeHead(400, buildCorsHeaders({ "Content-Type": "application/json" }));
    res.end(JSON.stringify({ error: "Ungültige Ziel-URL für Ollama Server." }));
    return;
  }

  try {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if ([TARGET_HEADER, "host", "connection", "transfer-encoding"].includes(lower)) {
        continue;
      }
      headers[key] = value;
    }

    const fetchOptions = {
      method,
      headers,
    };

    if (!["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = req;
      fetchOptions.duplex = "half";
    }

    if (process.env.DEBUG_PROXY === "1") {
      console.log(`Proxy ${method} ${targetUrl}`);
    }

    let proxyResponse;
    try {
      proxyResponse = await fetch(targetUrl, fetchOptions);
    }
    catch (fetchError) {
      console.error("Fetch error:", fetchError.toString());
      throw new Error(`Verbindungsfehler zum Ollama Server: ${fetchError}`);
    }
    if (process.env.DEBUG_PROXY === "1") {
      console.log(`^ult ${proxyResponse.status} ${proxyResponse.statusText}`);
    }
    const responseHeaders = {};
    proxyResponse.headers.forEach((value, key) => {
      if (!["transfer-encoding"].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    res.writeHead(proxyResponse.status, { ...corsHeaders, ...responseHeaders });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    if (method === "HEAD") {
      res.end();
      return;
    }

    if (!proxyResponse.body) {
      res.end();
      return;
    }

    const nodeStream =
      typeof Readable.fromWeb === "function"
        ? Readable.fromWeb(proxyResponse.body)
        : Readable.from(proxyResponse.body);

    try {
      await pipeline(nodeStream, res);
    } catch (streamError) {
      if (streamError.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        console.error("Proxy stream error:", streamError);
      }
      res.destroy();
    }
  } catch (error) {
    console.error("Proxy error:", error);
    res.writeHead(502, buildCorsHeaders({ "Content-Type": "application/json" }));
    res.end(
      JSON.stringify({
        error: "Fehler beim Verbinden zum Ollama Server.",
        details: error.message,
      })
    );
  }

  res.on("close", () => {
    if (req.destroyed === false) {
      req.destroy();
    }
  });
}

function ensureProtocol(url) {
  if (!/^https?:\/\//i.test(url)) {
    return `http://${url.replace(/^\/+/, "")}`;
  }
  return url;
}

module.exports = server;
