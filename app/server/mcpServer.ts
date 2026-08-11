/**
 * MCP (Model Context Protocol) server — how an outside AI agent reads this app.
 *
 * Claude Desktop, claude.ai and anything else that speaks MCP can connect and call the read-only
 * tools in `mcpTools.ts`. Two transports, one implementation: this module handles JSON-RPC frames
 * and does not care whether they arrived over HTTP (the `/mcp` endpoint, for hosted clients) or
 * over a pipe (the stdio bridge in `../bin/mcp-bridge.mjs`, for Claude Desktop). The bridge is a
 * dumb relay precisely because the protocol lives here.
 *
 * **Why the protocol is written out rather than imported.** The official SDK would pull Hono,
 * Express 5, jose, ajv, cors and an OAuth client into an app that already runs Express 4 with
 * fifteen hand-picked dependencies. This server is stateless and exposes tools only — no
 * sessions, no resources, no prompts, no sampling, no server-initiated messages — which is a
 * couple of hundred lines of well-specified JSON-RPC. That trade would look different the day
 * this needs sessions or OAuth; it does not need them to answer questions about invoices.
 */

import type { Request, Response } from 'express';
import { MCP_SERVER_INFO, MCP_TOOLS, TOOLS_BY_NAME } from './mcpTools.js';

/**
 * Protocol revisions this server can speak, newest first.
 *
 * Nothing here varies by revision — a tools-only server looks the same in all of them — so the
 * list exists to answer the client honestly during negotiation rather than to switch behaviour.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
} & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } });

const ok = (id: string | number | null, result: unknown): JsonRpcResponse =>
  ({ jsonrpc: '2.0', id, result });

const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse =>
  ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * Handles one JSON-RPC message.
 *
 * Returns `null` for a notification — a message with no `id`, which by the spec gets no reply at
 * all. `notifications/initialized` is the one every client sends, and answering it is a protocol
 * error rather than a harmless extra.
 */
export function handleRpc(message: JsonRpcRequest): JsonRpcResponse | null {
  const id = message?.id ?? null;
  const isNotification = message?.id === undefined || message?.id === null;

  if (message?.jsonrpc !== '2.0' || typeof message?.method !== 'string') {
    return isNotification ? null : fail(id, INVALID_REQUEST, 'not a JSON-RPC 2.0 request');
  }

  switch (message.method) {
    case 'initialize': {
      // Echo the client's revision when we know it, so it does not have to downgrade; otherwise
      // answer with ours and let the client decide whether it can live with that.
      const asked = message.params?.protocolVersion;
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: version,
        // Tools only, and the list never changes at runtime — hence no listChanged.
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
        instructions: MCP_SERVER_INFO.instructions,
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return isNotification ? null : ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case 'tools/call': {
      const name = message.params?.name;
      const tool = typeof name === 'string' ? TOOLS_BY_NAME.get(name) : undefined;
      if (!tool) return fail(id, INVALID_PARAMS, `unknown tool: ${name}`);

      try {
        const data = tool.handler(message.params?.arguments ?? {});
        return ok(id, {
          // Text content holding JSON is the interoperable shape: every MCP client renders it,
          // and every model reads it. `structuredContent` carries the same data for clients that
          // prefer it — same object, so the two cannot disagree.
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data && typeof data === 'object' && !Array.isArray(data) ? data : { result: data },
        });
      } catch (err) {
        // A failing tool is reported *inside* a successful result, not as a JSON-RPC error: the
        // spec reserves protocol errors for the protocol, and this way the model sees what went
        // wrong and can try a different tool instead of the whole call vanishing.
        return ok(id, {
          content: [{ type: 'text', text: `Tool ${tool.name} failed: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }

    // Declared unsupported rather than silently empty, so a client does not think this server
    // has resources or prompts and none are configured.
    default:
      return isNotification ? null : fail(id, METHOD_NOT_FOUND, `method not supported: ${message.method}`);
  }
}

/**
 * The Streamable HTTP transport, as an Express handler.
 *
 * Stateless: every POST is a complete exchange, answered with plain JSON rather than an SSE
 * stream. The spec allows this for a server that never initiates messages, and it means no
 * session table, no stream to reconnect, and nothing to clean up when a client disappears —
 * which matters on a single small VM.
 */
export function mcpHttpHandler(req: Request, res: Response) {
  if (req.method === 'GET' || req.method === 'DELETE') {
    // GET opens a server-initiated event stream and DELETE ends a session. This server has
    // neither, and saying so plainly beats an idle stream a client waits on forever.
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: INVALID_REQUEST, message: 'this MCP server is stateless — use POST' },
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const body = req.body;
  if (body === undefined || body === null || typeof body !== 'object') {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'invalid JSON body' } });
  }

  try {
    // A batch is answered with an array of only the messages that had an id; a batch made
    // entirely of notifications gets 202 and no body, same as a single one.
    if (Array.isArray(body)) {
      const replies = body.map(handleRpc).filter((r): r is JsonRpcResponse => r !== null);
      if (replies.length === 0) return res.status(202).end();
      return res.json(replies);
    }

    const reply = handleRpc(body as JsonRpcRequest);
    if (reply === null) return res.status(202).end();
    return res.json(reply);
  } catch (err) {
    console.error('[mcp] unhandled error:', err);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: INTERNAL_ERROR, message: 'internal error' },
    });
  }
}
