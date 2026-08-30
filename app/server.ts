import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadUser, requireApiKey } from './server/auth.js';
import { router, apiV1 } from './server/routes.js';
import { mcpHttpHandler } from './server/mcpServer.js';
import { runSeed } from './server/seed.js';
import { backfillMoonlight } from './server/moonlight.js';
import {
  backfillMemberPayments, backfillSupplierPayments, pruneOrphanPayments,
} from './server/supplierPayments.js';
import { backfillSupplierAliases } from './server/supplierNames.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = parseInt(process.env.PORT || '3000');

runSeed();
// Links every show to its expense row and refreshes the derived columns. Idempotent, so it
// also picks up shows a previous version's calendar sync created without one.
backfillMoonlight();
// Gives every cost line already marked שולם the payment row it never had. Runs after the
// backfill above, which is what guarantees each show has an expense row to read the fees from.
backfillSupplierPayments();
// And the members' shares of every show already settled with them: their invoices are owed
// to the books exactly as a supplier's are, and were the larger half nobody was counting.
backfillMemberPayments();
// Cheap, and a payment covering nothing would otherwise sit in the queue for ever.
pruneOrphanPayments();
// Moves the invoice names off the supplier's free-text column into the table that can be
// edited from the screen that notices one is missing.
backfillSupplierAliases();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(loadUser);

app.use('/api/v1', apiV1);
app.use('/api', router);

// Read-only MCP endpoint, for AI agents (Claude Desktop and anything else that speaks MCP).
// Authenticated with the same X-API-Key mechanism as /api/v1 — a key created in
// Settings → מפתחות API — so revoking a key cuts an agent off exactly like any other client.
// Mounted here rather than inside the API routers because it speaks JSON-RPC, not REST.
app.all('/mcp', requireApiKey, mcpHttpHandler);

async function start() {
  if (isProd) {
    const dist = path.join(__dirname, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(port, () => console.log(`Account Manager running on http://localhost:${port}`));
}

start();
