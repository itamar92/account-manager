/**
 * Environment loading, before anything that reads it.
 *
 * Imported first by `server.ts`, because modules further down read `process.env` while they are
 * being evaluated — `db.ts` resolves `DATA_DIR`, `morningClient.ts` its base URL — and an import
 * that ran earlier would see nothing.
 *
 * Two files are read, and this is the point of the module: `dotenv/config` alone resolves `.env`
 * against the working directory, so `npm run dev` from `app/` sees `app/.env` and never the one
 * at the repository root — even though the root `.env.example` is what documents the app's own
 * credentials. Reading both means either location works. `app/.env` is loaded first and wins,
 * since dotenv does not overwrite a variable that is already set, and a real environment
 * variable still beats both.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// app/.env — the more specific of the two, so it goes first.
dotenv.config();
// The repository root, two levels up from app/server.
dotenv.config({ path: path.join(here, '..', '..', '.env') });
