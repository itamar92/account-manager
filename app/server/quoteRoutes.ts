import { Router } from 'express';
import { requireAuth } from './auth.js';
import { getVatPercent } from './db.js';
import {
  EVENT_TYPES, cancelQuote, createBlankQuote, createFromTemplate, createPackage, createTemplate,
  deletePackage, deleteQuote, duplicateQuote, getQuote, listPackages, listQuotes, listTemplates,
  quoteSettings, saveAsTemplate, saveQuoteSettings, updatePackage, updateQuote,
} from './quotes.js';

/**
 * The quotes section, mounted at /api/moonlight/quotes.
 *
 * Every route here is `requireAuth`, not `requireOwner`, and that is deliberate: this is the one
 * part of Moonlight the band members write to as well as read. Selling a show is something every
 * member does, so a quote is theirs to make, edit and send exactly as it is the owner's — see
 * docs/QUOTES-DESIGN.md. Tightening these to owner-only would not be a fix; it would take the
 * feature away from the people it was built for.
 */
export const quoteRouter = Router();

quoteRouter.use(requireAuth);

function handle(fn: (req: any, res: any) => void) {
  return (req: any, res: any) => {
    try {
      fn(req, res);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || 'internal error' });
    }
  };
}

const userId = (req: any): string | null => req.user?.id ?? null;

quoteRouter.get('/', handle((_req, res) => {
  res.json({ quotes: listQuotes() });
}));

// ---- the fixed paths first, so none of them is read as a quote id ----

quoteRouter.get('/templates', handle((_req, res) => {
  res.json({ templates: listTemplates() });
}));

quoteRouter.post('/templates', handle((req, res) => {
  const id = createTemplate(req.body || {}, userId(req));
  res.json(getQuote(id));
}));

quoteRouter.get('/packages', handle((_req, res) => {
  res.json({ packages: listPackages() });
}));

quoteRouter.post('/packages', handle((req, res) => {
  res.json({ package: createPackage(req.body) });
}));

quoteRouter.put('/packages/:id', handle((req, res) => {
  res.json({ package: updatePackage(req.params.id, req.body) });
}));

quoteRouter.delete('/packages/:id', handle((req, res) => {
  deletePackage(req.params.id);
  res.json({ ok: true });
}));

/** The settings, and the two fixed lists every quote screen needs beside them. */
quoteRouter.get('/settings', handle((_req, res) => {
  res.json({ settings: quoteSettings(), event_types: EVENT_TYPES, vat_percent: getVatPercent() });
}));

quoteRouter.put('/settings', handle((req, res) => {
  res.json({ settings: saveQuoteSettings(req.body || {}) });
}));

// ---- one quote ----

/** A template id makes it the everyday quote; without one it is a blank quote. */
quoteRouter.post('/', handle((req, res) => {
  const b = req.body || {};
  const id = b.template_id
    ? createFromTemplate(String(b.template_id), b, userId(req))
    : createBlankQuote(b, userId(req));
  res.json(getQuote(id));
}));

quoteRouter.get('/:id', handle((req, res) => {
  res.json(getQuote(req.params.id));
}));

quoteRouter.put('/:id', handle((req, res) => {
  res.json(updateQuote(req.params.id, req.body || {}, userId(req)));
}));

quoteRouter.post('/:id/duplicate', handle((req, res) => {
  res.json(getQuote(duplicateQuote(req.params.id, userId(req))));
}));

quoteRouter.post('/:id/cancel', handle((req, res) => {
  res.json(cancelQuote(req.params.id, userId(req)));
}));

quoteRouter.post('/:id/save-as-template', handle((req, res) => {
  res.json(getQuote(saveAsTemplate(req.params.id, req.body?.template_name, userId(req))));
}));

quoteRouter.delete('/:id', handle((req, res) => {
  deleteQuote(req.params.id);
  res.json({ ok: true });
}));
