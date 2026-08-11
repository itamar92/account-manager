#!/usr/bin/env node
/**
 * stdio ↔ HTTP bridge, so Claude Desktop can reach the Account Manager MCP server.
 *
 * Claude Desktop launches local MCP servers as a child process and talks newline-delimited
 * JSON-RPC over stdin/stdout, passing secrets through `env` in claude_desktop_config.json. Its
 * remote-connector flow, by contrast, takes a URL and expects OAuth — which is a lot of moving
 * parts for one person's own app. This script is the shortest path between the two: it reads
 * frames from stdin, POSTs each one to /mcp with the API key attached, and writes the reply back.
 *
 * It understands no MCP whatsoever, deliberately. Every protocol decision lives in
 * `server/mcpServer.ts`, so adding a tool or moving to a new protocol revision changes the server
 * and this file keeps working untouched. It has no dependencies — plain Node, nothing to install.
 *
 * Configure it in claude_desktop_config.json:
 *
 *   {
 *     "mcpServers": {
 *       "account-manager": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/account-manager/app/bin/mcp-bridge.mjs"],
 *         "env": {
 *           "AM_URL": "https://im-tools.org/mcp",
 *           "AM_API_KEY": "am_…"
 *         }
 *       }
 *     }
 *   }
 *
 * The key is created in the app under Settings → מפתחות API and is shown exactly once.
 */

const URL_ = process.env.AM_URL || 'http://127.0.0.1:3000/mcp';
const API_KEY = process.env.AM_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.AM_TIMEOUT_MS || '30000', 10);

// stderr is the only channel that is safe to write to: stdout carries protocol frames, and a
// stray log line there corrupts the stream and takes the whole connection down.
const log = (...args) => console.error('[am-mcp-bridge]', ...args);

if (!API_KEY) {
  log('AM_API_KEY is not set — create a key in Settings → מפתחות API and put it in the env block.');
  process.exit(1);
}

/** Writes one JSON-RPC frame to Claude Desktop. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Reports a transport failure as a JSON-RPC error against the frame that caused it.
 *
 * A dead connection has to surface as an answer, not as silence: a client waiting on an id it
 * will never hear about again hangs rather than showing the user what went wrong.
 */
function sendError(id, message) {
  if (id === undefined || id === null) return;   // a notification has nobody waiting on it
  send({ jsonrpc: '2.0', id, error: { code: -32603, message } });
}

async function forward(frame) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(frame),
      signal: controller.signal,
    });

    // 202 is the server acknowledging a notification. Nothing to relay.
    if (res.status === 202 || res.status === 204) return;

    const text = await res.text();
    if (!res.ok) {
      // 401 is the one worth naming: it is almost always a revoked or mistyped key, and the
      // generic "request failed" sends people looking at the network instead.
      const hint = res.status === 401 ? ' — check AM_API_KEY (the key may have been revoked)' : '';
      return sendError(frame.id, `account-manager returned ${res.status}${hint}: ${text.slice(0, 200)}`);
    }

    try {
      // The server answers one frame with one frame; relay it verbatim rather than
      // reconstructing it, so nothing this script misunderstands can alter the payload.
      send(JSON.parse(text));
    } catch {
      sendError(frame.id, `account-manager returned a non-JSON body: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    const reason = err.name === 'AbortError' ? `no answer within ${TIMEOUT_MS} ms` : err.message;
    sendError(frame.id, `could not reach account-manager at ${URL_}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Frames arrive newline-delimited and a chunk boundary can fall anywhere, so the tail of a chunk
 * is held until its newline shows up. Requests are forwarded without waiting for the previous
 * reply — each carries its own id, and serialising them would make a slow tool call block
 * everything behind it.
 */
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      log('ignoring unparseable line from client');
      continue;
    }
    void forward(frame);
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
