import { Router, type NextFunction, type Request, type Response } from 'express';
import { clientIp, requireOwner } from './auth.js';
import {
  BoardError, boardAdmin, crewBoard, publicBoard, setBoardEnabled, updateBoardItem, updateBoardSettings,
  type BoardKind,
} from './showBoard.js';

/**
 * The two show boards (server/showBoard.ts).
 *
 * `publicBoardRouter` is mounted at /api/public/boards with no login: the token in the path is
 * the credential. `showBoardRouter` is the owner's screen for both, at /api/show-board.
 */
export const publicBoardRouter = Router();
export const showBoardRouter = Router();

function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (err: any) {
      res.status(err instanceof BoardError ? err.status : 500).json({ error: err.message || 'internal error' });
    }
  };
}

/** A brake per address, the same in-memory window the quote links use. */
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

publicBoardRouter.use((_req, res, next) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  next();
});

const limit = rateLimit(120, 10 * 60 * 1000);
publicBoardRouter.get('/shows/:token', limit, handle((req, res) => res.json(publicBoard(req.params.token))));
publicBoardRouter.get('/crew/:token', limit, handle((req, res) => res.json(crewBoard(req.params.token))));

showBoardRouter.use(requireOwner);

showBoardRouter.get('/', handle((_req, res) => res.json(boardAdmin())));

showBoardRouter.put('/settings', handle((req, res) => {
  res.json({ settings: updateBoardSettings(req.body || {}) });
}));

/** Switch a board on (a fresh link, which also retires the old one) or off. */
showBoardRouter.post('/:kind/link', handle((req, res) => {
  const kind = req.params.kind as BoardKind;
  if (kind !== 'public' && kind !== 'crew') throw new BoardError('לוח לא מוכר', 404);
  res.json({ token: setBoardEnabled(kind, req.body?.enabled !== false) });
}));

showBoardRouter.put('/items/:key', handle((req, res) => {
  res.json({ item: updateBoardItem(req.params.key, req.body || {}) });
}));
