// e2e/utils/fixture-server.ts
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const FIXTURES_DIR = join(__dirname, "..", "..", "tests", "fixtures");
const PORT = 34567;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

let serverInstance: ReturnType<typeof createServer> | null = null;

export function startFixtureServer(): Promise<FixtureServer> {
  return new Promise((resolve, reject) => {
    if (serverInstance) {
      resolve({ url: `http://localhost:${PORT}`, close: stopFixtureServer });
      return;
    }

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = req.url?.split("?")[0] ?? "/";
      let filePath = urlPath === "/" ? "/stage-1-contact.html" : urlPath;

      // Prevent directory traversal
      if (filePath.includes("..")) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }

      const fullPath = join(FIXTURES_DIR, filePath);
      const ext = extname(fullPath);
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const content = readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": mimeType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(PORT, () => {
      serverInstance = server;
      resolve({
        url: `http://localhost:${PORT}`,
        close: stopFixtureServer,
      });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

export function stopFixtureServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}