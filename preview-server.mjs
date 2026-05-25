import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const port = 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const pathname = url.pathname === "/" ? "/standalone.html" : url.pathname;
  const cleanPath = pathname.replace(/^\/+/, "");

  try {
    const body = await readFile(join(root, cleanPath));
    response.writeHead(200, { "Content-Type": types[extname(cleanPath)] ?? "text/plain; charset=utf-8" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Preview running at http://127.0.0.1:${port}/`);
});
