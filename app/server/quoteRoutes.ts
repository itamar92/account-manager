import express, { Router } from 'express';
import { requireAuth, requireOwner } from './auth.js';
import { getVatPercent } from './db.js';
import { regenerateLink, sendQuote } from './quoteLink.js';
import { linkQuoteToShow, markSignedSeen, settleShowAmount, showsOnDate } from './quoteShow.js';
import { calendarDraft, calendarReady, createQuoteEvent, updateQuoteEvent } from './quoteCalendar.js';
import {
  FileError, MAX_IMAGE_BYTES, brandingImage, isBrandingKind, removeBrandingImage, saveBrandingImage,
} from './quoteFiles.js';
import {
  EVENT_TYPES, builtinTemplates, cancelQuote, createBlankQuote, createBuiltinTemplate, createFromTemplate, createPackage, createTemplate,
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
 *
 * The one exception is the signature. It is the owner's own hand, signing for the band, so the
 * band sees it on every quote they make but only the owner can put it there, change it or take
 * it away.
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

/** The same, for the routes that wait on Google. */
function handleAsync(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any) => {
    fn(req, res).catch((err: any) => res.status(err.status || 500).json({ error: err.message || 'internal error' }));
  };
}

const userId = (req: any): string | null => req.user?.id ?? null;

quoteRouter.get('/', handle((_req, res) => {
  res.json({ quotes: listQuotes() });
}));

// ---- the fixed paths first, so none of them is read as a quote id ----

quoteRouter.get('/templates', handle((_req, res) => {
  res.json({ templates: listTemplates(), builtins: builtinTemplates() });
}));

quoteRouter.post('/templates', handle((req, res) => {
  const id = createTemplate(req.body || {}, userId(req));
  res.json(getQuote(id));
}));

/** Another copy of a template the system comes with: `{ key }`, or Moonlight's own quote. */
quoteRouter.post('/templates/builtin', handle((req, res) => {
  res.json(getQuote(createBuiltinTemplate(String(req.body?.key ?? 'moonlight'), userId(req))));
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
  res.json({
    settings: quoteSettings(), event_types: EVENT_TYPES, vat_percent: getVatPercent(),
    // Whether a quote can put its «אופציה» on the calendar: connected, and a band rule to read it.
    calendar_ready: calendarReady(),
  });
}));

quoteRouter.put('/settings', handle((req, res) => {
  const patch = { ...(req.body || {}) };
  // The name under the signature is part of the signature. A band member's form still carries
  // it, unchanged, so it is dropped rather than refused.
  if (req.user?.role !== 'owner') delete patch.signature_name;
  res.json({ settings: saveQuoteSettings(patch) });
}));

/** The shows on a date, so the editor can offer «יש הופעה בתאריך הזה — לשייך?». */
quoteRouter.get('/show-candidates', handle((req, res) => {
  res.json({ shows: showsOnDate(String(req.query.date ?? ''), String(req.query.quote_id ?? '')) });
}));

// ---- the logo and the signature ----

/** The signature is the owner's; the logo is anybody's. */
const ownerForSignature = (req: any, res: any, next: any) =>
  req.params.kind === 'signature' ? requireOwner(req, res, next) : next();

/**
 * The image as the request body, whatever it claims to be — saveBrandingImage reads what it
 * actually is from its bytes. An oversized one is answered in JSON like every other refusal,
 * rather than with the HTML page Express would otherwise send.
 */
const rawImage = (req: any, res: any, next: any) =>
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES })(req, res, (err?: any) => {
    if (!err) return next();
    res.status(err.status || 400).json({
      error: err.type === 'entity.too.large' ? 'התמונה גדולה מ־5MB' : 'ההעלאה נכשלה',
    });
  });

quoteRouter.get('/branding/:kind', (req, res) => {
  const kind = req.params.kind;
  const file = isBrandingKind(kind) ? brandingImage(kind) : null;
  if (!file) return res.status(404).json({ error: 'אין תמונה' });
  res.set({
    'Content-Type': file.mime,
    'X-Content-Type-Options': 'nosniff',
    // Addressed by its own id, so it can be kept for ever; asked for without one, it must not be.
    'Cache-Control': req.query.v === file.id ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  });
  res.send(file.data);
});

quoteRouter.post('/branding/:kind', ownerForSignature, rawImage, (req: any, res: any) => {
  const kind = req.params.kind;
  if (!isBrandingKind(kind)) return res.status(404).json({ error: 'not found' });
  try {
    saveBrandingImage(kind, req.body, userId(req));
    res.json({ settings: quoteSettings() });
  } catch (err: any) {
    res.status(err instanceof FileError ? err.status : 500).json({ error: err.message || 'internal error' });
  }
});

quoteRouter.delete('/branding/:kind', ownerForSignature, handle((req, res) => {
  const kind = req.params.kind;
  if (!isBrandingKind(kind)) return res.status(404).json({ error: 'not found' });
  removeBrandingImage(kind);
  res.json({ settings: quoteSettings() });
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

/** Opening a signed quote is the band having seen it, so it leaves the «נחתמו» news. */
quoteRouter.get('/:id', handle((req, res) => {
  markSignedSeen(req.params.id);
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

/**
 * Where the client's link points. PUBLIC_BASE_URL wins when it is set — for a hostname kept
 * outside Cloudflare Access just for clients — and otherwise the link is the address the app was
 * opened at, which the browser states in Origin.
 */
const baseUrl = (req: any): string =>
  process.env.PUBLIC_BASE_URL?.trim() || req.get('origin') || `${req.protocol}://${req.get('host')}`;

/** The link, and the message it goes out with; the dialog opens WhatsApp or the mail app with them. */
quoteRouter.post('/:id/send', handle((req, res) => {
  const share = sendQuote(req.params.id, userId(req), baseUrl(req));
  res.json({ ...getQuote(req.params.id), share });
}));

quoteRouter.post('/:id/regenerate-link', handle((req, res) => {
  const share = regenerateLink(req.params.id, baseUrl(req));
  res.json({ ...getQuote(req.params.id), share });
}));

/** { show_id }: a show's id, or null to unlink a quote not yet signed. Shows themselves come from the calendar. */
quoteRouter.post('/:id/link-show', handle((req, res) => {
  const target = req.body?.show_id;
  linkQuoteToShow(req.params.id, target === undefined || target === '' ? null : target);
  res.json(getQuote(req.params.id));
}));

/**
 * The quote and its show disagree on the price. { use: 'show' } keeps the show's figure, which
 * anyone in the band may decide; { use: 'quote' } writes the quote's figure into the show, and a
 * show's money is the owner's to change.
 */
quoteRouter.post('/:id/show-amount', handle((req, res) => {
  const use = req.body?.use === 'quote' ? 'quote' : 'show';
  if (use === 'quote' && req.user?.role !== 'owner') {
    return void res.status(403).json({ error: 'רק בעל החשבון משנה את סכום ההופעה' });
  }
  settleShowAmount(req.params.id, use);
  res.json(getQuote(req.params.id));
}));

/**
 * The quote's calendar event. Anyone who edits quotes can hold a date with one, since that is
 * part of making the quote; the event goes on the band rule's calendar, and the calendar sync
 * makes the show from it — the one way a show comes into being.
 */
quoteRouter.get('/:id/calendar', handleAsync(async (req, res) => {
  res.json(await calendarDraft(req.params.id));
}));

quoteRouter.post('/:id/calendar', handleAsync(async (req, res) => {
  res.json(await createQuoteEvent(req.params.id, req.body || {}));
}));

quoteRouter.put('/:id/calendar', handleAsync(async (req, res) => {
  res.json(await updateQuoteEvent(req.params.id, req.body || {}));
}));

quoteRouter.post('/:id/save-as-template', handle((req, res) => {
  res.json(getQuote(saveAsTemplate(req.params.id, req.body?.template_name, userId(req))));
}));

quoteRouter.delete('/:id', handle((req, res) => {
  deleteQuote(req.params.id);
  res.json({ ok: true });
}));
