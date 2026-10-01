import { Router, type NextFunction, type Request, type Response } from 'express';
import { clientIp } from './auth.js';
import { brandingImage, isBrandingKind } from './quoteFiles.js';
import { markViewed, publicQuote, signQuote } from './quoteLink.js';
import { QuoteError } from './quotes.js';

/**
 * The client's link, mounted at /api/public/quotes — the one part of the app with no login.
 *
 * The token in the path is the whole of the credential: it opens that one quote, to read and to
 * sign, and nothing else. Every response says not to be indexed and not to pass the address on
 * as a referrer, so the link does not leak out of the page it is opened in.
 */
export const publicQuoteRouter = Router();

publicQuoteRouter.use((_req, res, next) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  next();
});

/**
 * A brake per address, the same in-memory window the login uses. The tokens cannot be guessed,
 * so this is for a page left reloading or a script hammering «אישור», not for secrecy.
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; first: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (hits.size > 2000) for (const [k, v] of hits) if (now - v.first > windowMs) hits.delete(k);
    const key = clientIp(req);
    const entry = hits.get(key);
    if (!entry || now - entry.first > windowMs) {
      hits.set(key, { count: 1, first: now });
      return next();
    }
    if (++entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((windowMs - (now - entry.first)) / 1000)));
      return res.status(429).json({ error: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' });
    }
    next();
  };
}

function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (err: any) {
      res.status(err instanceof QuoteError ? err.status : 500).json({ error: err.message || 'internal error' });
    }
  };
}

const MINUTES = 60 * 1000;

publicQuoteRouter.get('/:token', rateLimit(120, 10 * MINUTES), handle((req, res) => {
  res.json(publicQuote(req.params.token));
}));

/** A member of the band opening the link is checking it, not the client reading it. */
publicQuoteRouter.post('/:token/view', rateLimit(60, 10 * MINUTES), handle((req, res) => {
  if (!req.user) markViewed(req.params.token);
  res.json({ ok: true });
}));

publicQuoteRouter.post('/:token/sign', rateLimit(10, 15 * MINUTES), handle((req, res) => {
  res.json(signQuote(req.params.token, req.body || {}, {
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
  }));
}));

/** The logo and the band's signature, by the quote's own link and only while it works. */
publicQuoteRouter.get('/:token/branding/:kind', handle((req, res) => {
  publicQuote(req.params.token); // throws 404 for a link that is not, or is no longer, one
  const kind = req.params.kind;
  const file = isBrandingKind(kind) ? brandingImage(kind) : null;
  if (!file) return void res.status(404).json({ error: 'אין תמונה' });
  res.set({
    'Content-Type': file.mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': req.query.v === file.id ? 'private, max-age=86400' : 'no-store',
  });
  res.send(file.data);
}));
