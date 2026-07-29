import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadUser } from './server/auth.js';
import { router, apiV1 } from './server/routes.js';
import { runSeed } from './server/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = parseInt(process.env.PORT || '3000');

runSeed();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(loadUser);

app.use('/api/v1', apiV1);
app.use('/api', router);

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
