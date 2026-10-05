/**
 * Talk to the built server over real stdio and list its tools.
 *
 * This is the check CI would otherwise miss: the suite can be green while the
 * server fails to register a tool or crashes on connect, and that is the only
 * failure a user ever sees. It speaks JSON-RPC directly, so it needs no client
 * library, and keeps stdin open until the answer arrives, because the MCP stdio
 * binding stops a server whose input has ended.
 */
import { spawn } from "node:child_process";

const expected = { default: 14, readonly: 9, nodestructive: 11 };
let failed = false;

function listTools(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/index.js"], { env, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("no answer to tools/list within 20 s"));
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(message.result?.tools ?? []);
        }
      }
    });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci-handshake", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

for (const [mode, count] of Object.entries(expected)) {
  const env = { ...process.env };
  if (mode === "readonly") env.TIKTOK_READ_ONLY = "1";
  if (mode === "nodestructive") env.TIKTOK_ALLOW_DESTRUCTIVE = "0";

  const tools = await listTools(env);
  const ok = tools.length === count;
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${mode}: ${tools.length} tools (expected ${count})`);

  for (const tool of tools) {
    if (!tool.description || tool.description.length < 60) {
      failed = true;
      console.log(`FAIL  ${tool.name} has no usable description`);
    }
  }
}

process.exit(failed ? 1 : 0);
