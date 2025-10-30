"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs/promises");

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

const server = http.createServer(async (req, res) => {
  try {
    const { method = "GET" } = req;
    const requestPath = sanitizePath(req.url || "/");
    const resolvedPath = path.resolve(ROOT_DIR, requestPath);

    if (!resolvedPath.startsWith(ROOT_DIR)) {
      res.writeHead(403);
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

    const data = await fs.readFile(filePath);
    const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";

    res.writeHead(200, buildHeaders(mimeType));
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    console.error("Server error:", error);
    res.writeHead(500);
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

function shouldServeIndex(requestPath) {
  return !path.extname(requestPath);
}

function buildHeaders(mimeType) {
  const headers = {
    "Content-Type": mimeType,
  };

  if (isProduction) {
    headers["Cache-Control"] = "public, max-age=3600";
  } else {
    headers["Cache-Control"] = "no-store";
  }

  return headers;
}

module.exports = server;
