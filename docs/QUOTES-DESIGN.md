# Moonlight Quotes (הצעות מחיר) — design

Status: **draft for review** · 2026-09-30

A quotes section inside Moonlight: build a price quote for a show, send the client a link on
WhatsApp, let them sign it on their phone, and have the signed quote become a show in the books.

The functional starting point is [itamar92/Quotes_Creator_System](https://github.com/itamar92/Quotes_Creator_System)
(a Base44 app). This design keeps its user experience and rebuilds it natively in this app. It
fixes the original's gaps as it goes (see [What we deliberately do not port](#what-we-deliberately-do-not-port)).

## Decisions

| Question | Decision |
|---|---|
| What a signed quote does | It **becomes a show**: it creates or links a `band_events` row with the agreed amount |
| Client experience | **Full port**: a public branded page on a secret link, with a drawn signature |
| Delivery | **A link, sent on WhatsApp or by email.** Both open from the sender's own WhatsApp or mail (a `wa.me`, `mailto:` or Gmail compose link), so the app itself sends nothing and the client's reply reaches a person. The email is designed HTML, pasted in from the clipboard, since a compose link carries plain text only |
| Band members | Can **create, edit, send and delete any quote**, and manage packages and quote settings |
| Identity on the quote | **Moonlight only**: band name, logo, contact person. No legal business details |
| Extra contents | **Saved packages** (price list) and **file attachments** |
| Signed copy | Frozen in the DB. The page has a **print layout**, and "save as PDF" comes from the browser |
| Everyday quote | A **template** holds the usual content. A new quote asks only for client, date and price (see [Templates](#templates)) |

These were chosen by default and are open to change:

- **Event types:** חתונה, בר/בת מצווה, אירוע פרטי, אירוע חברה, מועדון/הופעה, פסטיבל, אחר.
- **VAT:** each quote says whether its prices include VAT or have VAT added. A setting supplies the default, and the rate comes from `getVatPercent()`.
- **Numbering and validity:** quotes are numbered `ML-2026-001`, one sequence per year. They are valid for 14 days by default and expire at the end of the day, Israel time.
- **Declining:** the client cannot decline in v1. A quote nobody signs simply expires or gets cancelled.
- **Out of scope:** Morning type-10 "הצעת מחיר" documents and MCP tools. Both are possible follow-ups.

## Approaches considered

1. **Native rebuild in this app (chosen).**
   - Port the UX, the Hebrew copy and the pricing logic onto Express + SQLite + `ui.tsx`.
   - One login and one database. Signing can write straight into `band_events`.
   - The public surface is exactly one token-scoped API, instead of a publicly writable entity.
2. **Keep the Base44 app and sync it in.**
   - Embed it or link to it, then pull signed quotes over by webhook.
   - This means two logins and a permanent Base44 dependency. It also keeps the original's publicly writable `Quote` entity, and needs a sync layer just to create a show.
3. **Copy the JSX components and swap Base44 calls for an adapter.**
   - This gets something on screen faster.
   - But it drags in shadcn/Radix and about 40 unused dependencies, adds untyped JS to a strict TS codebase, brings a second design system, and inherits every bug listed below.

## Data model (`server/db.ts`)

New tables are added with `CREATE TABLE IF NOT EXISTS`, following the existing pattern.

```sql
CREATE TABLE IF NOT EXISTS band_quotes (
  id TEXT PRIMARY KEY,
  is_template INTEGER NOT NULL DEFAULT 0,     -- see Templates
  template_name TEXT,
  quote_number TEXT UNIQUE,                   -- ML-2026-001; NULL on a template
  public_token TEXT UNIQUE,                   -- set on first send; regenerable
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','signed','cancelled')),
  -- client
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT,
  client_email TEXT,
  client_tax_id TEXT,                         -- ח.פ./ת.ז., optional, for invoicing later
  -- event
  event_type TEXT,
  event_date TEXT,                            -- YYYY-MM-DD; required to send
  event_location TEXT,
  guest_count INTEGER,
  show_duration TEXT,                         -- free text: «כ־40 דקות», «שני סטים של 45 דקות»
  -- content
  title TEXT NOT NULL,
  intro TEXT,
  terms TEXT,
  valid_until TEXT,                           -- YYYY-MM-DD; NULL on a template; required to send
  contact_name TEXT,                          -- defaults from settings
  contact_phone TEXT,
  internal_note TEXT,                         -- never sent to the public API
  -- money (always recomputed server-side on save)
  prices_include_vat INTEGER NOT NULL DEFAULT 0,
  vat_percent REAL NOT NULL,                  -- frozen at creation
  discount REAL NOT NULL DEFAULT 0,           -- ₪, applied before VAT
  subtotal REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL DEFAULT 0,         -- before VAT, after discount
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  -- links and lifecycle
  show_id TEXT REFERENCES band_events(id) ON DELETE SET NULL,
  show_link_status TEXT,                      -- what signing did: created / linked / choose / error
  show_amount_ok INTEGER NOT NULL DEFAULT 0,  -- the band kept the show's own price over the quote's
  signed_seen_at TEXT,                        -- first opened by the band after signing
  calendar_id TEXT, calendar_event_id TEXT,   -- the quote's «אופציה» event, and so its show
  calendar_event_title TEXT, calendar_event_link TEXT,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  sent_at TEXT, first_viewed_at TEXT, last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  -- signature (write-once)
  signed_at TEXT, signer_name TEXT, signature_png TEXT,
  signer_ip TEXT, signer_user_agent TEXT,
  signed_snapshot TEXT,                       -- JSON of exactly what was shown and signed
  signed_snapshot_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS band_quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES band_quotes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  package_id TEXT                             -- provenance only; the line is a copy
);

CREATE TABLE IF NOT EXISTS band_quote_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS band_quote_files (
  id TEXT PRIMARY KEY,
  quote_id TEXT REFERENCES band_quotes(id) ON DELETE CASCADE,  -- NULL = branding file
  kind TEXT NOT NULL CHECK (kind IN ('attachment','logo','cover','signature')),
  filename TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,                         -- the file itself; see Files
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Settings** are stored in the existing `settings` table, read and written with `getSetting`/`setSetting`:

- `quote_brand_name`
- `quote_logo_file_id`, `quote_signature_file_id` (and later `quote_cover_file_id`)
- `quote_color_primary`, `quote_color_accent`
- `quote_logo_position`: `right`, `center` (the default) or `left`
- `quote_signature_name`
- `quote_contact_name`, `quote_contact_phone`
- `quote_default_template_id`
- `quote_validity_days` (14)
- `quote_prices_include_vat`
- `quote_message_template`, `quote_email_subject` (empty = the defaults in `server/quoteShare.ts`)
- `quote_builtin_template_seeded`
- `quote_seq_<year>`

**Why items get their own table:** items are rows, not a JSON column. They are the thing that gets reordered and edited, and the rest of the schema is relational. The signed snapshot is the one place JSON is right, because it is a frozen record.

## Templates

Most quotes are the same quote: the same show, intro, lines and terms. Only the client, the
date and the price change. A **template** is where that usual content lives.

**Storage**
- A template is a `band_quotes` row with `is_template = 1` and a `template_name`.
- It has no number, no client, no validity date and no status of its own, and it never shows in the quotes list or the stats.
- Because it is an ordinary quote row, it uses the same editor, the same preview and the same items. Later it will also carry the same attachments.

**The built-in template**
- The app comes with one: Moonlight's own quote, the Google Doc «Template הצעת מחיר — להקת המחווה לקולדפליי» that the band sent for years. Its content lives in `server/quoteTemplates.ts`.
- It is added once, at startup (`seedBuiltinTemplate`, guarded by the setting `quote_builtin_template_seeded`). After that it is an ordinary template the band edits. Deleting it is final, and «תבניות» → «+ התבנית המוכנה של מונלייט» adds a fresh copy.
- Like any first template, it becomes the default only when there is no template yet.
- Where the Doc's parts went:

  | In the Doc | In the quote |
  |---|---|
  | `{{DATE}}` | The date the quote was made, under its number |
  | `{{תאריך האירוע}}`, `{{שם המקום}}`, `{{זמן מופע}}` | `event_date`, `event_location`, `show_duration`, shown as the header's chips |
  | `{{שם האירוע}}` | The client and the event type («עבור …», «חתונה») |
  | `{{AMPLIFICATION_TEXT}}` (the price paragraph) | The lines and the totals: the show, priced per quote, and «הגברה ותאורה» at no charge, which reads «כלול» |
  | Line-up, timings, production needs, payment, deposit, cancellation, force majeure | The first line's description, and the terms under four headings |

**Default template**
- The setting `quote_default_template_id` names the template that "הצעה חדשה" starts from.
- The first template created becomes the default. Deleting the default falls back to the next one.

**Quick create**
- "הצעה חדשה" opens a short form: template (the default is preselected), client name, client phone, event date and price. It then opens the new quote in the editor, where anything else can still be changed.
- The form also has the place and the show's length, which were the old Doc's other blanks. Both start as the template has them, and whichever the form does not send stays as the template has it.
- **The price** is written into the unit price of the template's **first line**, and the form names that line ("המחיר נכנס לשורה «הופעה מלאה»"). Every other line keeps its template price. The template's VAT mode decides whether that price is before or including VAT.
- **What is copied fresh:**
  - The VAT rate is today's rate, not the rate frozen on the template.
  - Validity is today plus `quote_validity_days`.
  - The contact details come from settings.
- **Placeholders:** `{client_name}` and `{event_date}` in the template's title and intro are filled in once, at creation. After that they are plain text in the quote.

**Other ways in**
- **"שמירה כתבנית"** on any quote turns a quote that is already right into a template. It copies content only: no client, number or signature.
- **"הצעה ריקה"** is still available for the odd one-off.

The quote settings keep only what is not per-quote: brand name, contact person, validity days, VAT default and the default template. Terms and intro live in the template, so there is one place to maintain them, not two.

## Money

This logic lives in `server/quotes.ts` as a pure function that both the API and the tests use.

```
line.total  = round2(quantity × unit_price)
subtotal    = Σ line.total
after       = max(0, subtotal − discount)
if prices exclude VAT:  net = after;                        vat = round2(net × rate/100); total = net + vat
if prices include VAT:  total = after;  net = round2(total / (1 + rate/100));             vat = total − net
```

- **Where totals are computed:** the server recomputes them on every save and ignores totals sent by the client. The editor runs the same function for its live preview.
- **Quantity:** can be fractional (for example 1.5 hours).
- **VAT rate:** frozen on the quote at creation, so a later rate change does not rewrite quotes that were already sent.

## Lifecycle

```
draft ──send──▶ sent ──first public view──▶ viewed ──sign──▶ signed (terminal)
  │               │                            │
  └──────────── cancel ◀───────────────────────┘      expired = derived, never stored
```

- **send**
  - Requires a client name, an event date, at least one line and a validity date.
  - Creates `public_token` if there is none and sets `sent_at`.
  - Opens the share dialog.
  - Resending a sent quote only reopens the dialog. It never changes the status.
- **viewed**
  - Set on the first public load by a visitor with no app session, so a logged-in preview never counts as a view.
  - Every public load bumps `view_count` and `last_viewed_at`.
- **expired** is a derived state, not a stored one.
  - It applies when the status is `sent` or `viewed` and today in Asia/Jerusalem is after `valid_until`.
  - Moving `valid_until` later reopens the quote.
- **Editing a sent quote**
  - Allowed, and the client sees the latest version. The editor warns that the client's link is live.
  - The public page submits the `updated_at` it rendered. If the quote changed since, the sign request fails with `409` and the page reloads it. This way nobody signs a version they did not see.
- **signed** is write-once and cannot be edited or deleted.
  - Changes go through **שכפול** (duplicate).
  - A duplicate copies the content only: no number, token, signature or show link.
- **Deleting and cancelling**
  - Delete is allowed only for `draft` and `cancelled`.
  - Cancel works on any unsigned quote. The link then shows "ההצעה אינה בתוקף".

## The calendar event, and the show it becomes

**Shows come from the calendar, and from nowhere else.** A quote does not create a show. It puts an event on the band's calendar, and the calendar sync makes the show from that event exactly as it does from any event typed into Google. Built in `server/quoteCalendar.ts`, with the shared helpers in `server/quoteOption.ts`.

**Holding the date** («שריון ביומן כאופציה»):
- Offered when a quote is created («הצעה חדשה» has the option ticked when the calendar is connected), and from the quote's «יומן והופעה» card at any time.
- The dialog starts with the title as the band writes them, «אופציה - הופעה קולדפליי אירוע חברה קיסריה»: the event type (or the client), then the place. Everything is editable: the title, a start and end time (none = all-day), and the location.
- **Who is invited:** every member with an email, ticked by default; any supplier, by role, unticked; and any other addresses. Google sends the invitations itself (`sendUpdates=all`). A supplier invited this way is staffed on the show automatically, since staffing already matches guests' emails.
- The event goes on the calendar of the enabled band rule. The dialog warns when the title would not be read as a show: a missing keyword (`הופעה` by default), or an ignore word.
- Once Google answers, that one event is run through the sync (`syncOneBandEvent`: the rule, `cleanTitle`, `applyBandEvent`), so the show appears at once rather than at the next sync. Only the band rule's half runs; a quote never touches the owner's personal works.
- The quote keeps `calendar_id`, `calendar_event_id`, `calendar_event_title` and `calendar_event_link`.

**After the client signs**, the card says the event is still «אופציה», and the dialog opens with the prefix already taken off. Saving rewrites the event (a guest who already answered keeps the answer), the sync renames the show from it, and the follow-up clears.

**Write access:** reading the calendar needs `calendar.readonly`; writing these events also needs `calendar.events`. A token issued read-only gets a message saying so, and `deploy/README.md` says how to issue a new one.

## Signing and the show

Built in `server/quoteShow.ts`. The steps below run right after the signature commits, in a separate step (`afterSigning`). A bookkeeping failure must never fail the client's signature. It is logged, the quote is marked `show_link_status = 'error'`, and it becomes a follow-up instead.

1. **The quote's show:** linked by hand, or made by the sync from the quote's own event. It gets the quote's amounts only if its amount is still 0. If the show already has a different amount, leave it and raise a follow-up saying the two disagree.
2. **Otherwise, the shows on `event_date`**, leaving out any show another live quote is already behind (linked to it, or made from its event: on a busy date that is somebody else's option):
   - **Exactly one:** link to it, and fill its amounts as in step 1.
   - **Several:** link nothing (`choose`), and the band picks one from the quote.
   - **None:** link nothing (`no_show`). The show comes from the calendar: the quote's event, created from the card, or an event typed into Google.
3. **A show that arrives later** is still linked: after every sync, full or of one event, `linkQuotesByCalendar` points each quote with no show at the show its event became, and a signed one then takes step 1. A quote the band pointed at a show by hand keeps that.

**Calendar duplicates:** `findOrphanBandEvent` in `calendarSync.ts` still adopts a hand-made show with no `calendar_event_id` on the same date, so a show typed in before its event reached the calendar is not doubled.

**Finishing what signing could not** (the card, `POST /:id/link-show`):
- Several shows on the date, or the show deleted since: pick one. The amounts follow exactly as they would have at signing.
- The wrong show: «זו לא ההופעה הנכונה» moves the quote to another show. An amount already written into the first show stays there, since nothing here erases a figure, and the card says so.
- A signed quote can move between shows but is never left with none. Before signing, linking is only a pointer and writes nothing to the show.

**A price that differs** (`POST /:id/show-amount`): «עדכון ההופעה לסכום ההצעה» writes the quote's figure into the show, and only the owner can do that, since it is the show's money. «הסכום בהופעה נכון» keeps the show's figure, and anyone in the band can decide it. Fixing the show's figure by hand clears the disagreement too, because it is worked out from the rows, not stored.

**Why the system can write the show:** show fields are owner-write through the API, but this write is made by the system as a result of the client's signature, not by a band member. It only fills a show that has no amount; a figure somebody typed is never overwritten.

## Permissions

- **All logged-in users** can read and write everything in the section: quotes, packages, quote settings and uploads. That means the owner and the band.
- **The one exception is the signature.** It is the owner's own hand, signing for the band, so only the owner can upload, replace or remove it (`requireOwner` on those two routes). A band member's settings save has `signature_name` dropped, not refused, because their form still carries it unchanged.
  - These routes use `requireAuth`, not `requireOwner`.
  - This is the first Moonlight area where band members write, which is deliberate. A comment at the router should say so, so nobody "fixes" it later.
- **`created_by`/`updated_by`** are recorded and shown in the list ("נוצרה ע״י").
- **Public API:** the token is the only credential. Anyone holding the link can view and sign that one quote, and nothing else.

## Server layout

| File | Contents |
|---|---|
| `server/quotes.ts` | Domain logic: numbering, templates, the edit/cancel/duplicate guards, settings |
| `server/quoteLink.ts` | The client's side: sending and the link's token, the client-safe view, view counting, signing and the signed snapshot |
| `server/quoteShare.ts` | The message and the WhatsApp, `mailto:` and Gmail links. No imports, so the share dialog uses the same file |
| `src/quotes/quoteEmail.ts` | The HTML email: header, message, the offer's card and the button to the link. Built in the browser, from the message as edited |
| `server/quoteRoutes.ts` | Authenticated router mounted at `/api/moonlight/quotes`. It lives in its own file because `routes.ts` is already 2,600 lines |
| `server/publicQuotes.ts` | Unauthenticated router mounted at `/api/public/quotes`, ahead of `/api` |
| `server/quoteFiles.ts` | Images and files: checking what an upload really is, storing it, serving it |

**Authenticated routes** (`quoteRoutes.ts`):

```
GET    /                          quotes (templates excluded)
GET    /templates                 templates + which is the default
POST   /                          create: blank, or { template_id, client_name, client_phone, event_date, price }
POST   /templates                 new blank template
POST   /:id/save-as-template      { template_name }
GET    /:id                       quote + items + files + linked show
PUT    /:id                       save (items replaced as a whole, totals recomputed)
POST   /:id/send                  → quote + { share: { url, message, subject, phone, email } }
POST   /:id/cancel | /:id/duplicate | /:id/regenerate-link
DELETE /:id                       draft/cancelled only
POST   /:id/files                 express.raw upload (same pattern as /reports/annual/parse)
DELETE /:id/files/:fileId
GET    /files/:fileId             authenticated download
GET|POST|PUT|DELETE /packages[/:id]
GET|PUT /settings                 + POST /settings/logo, /settings/cover
```

**Public routes** (`publicQuotes.ts`):

```
GET  /:token                      client-safe view model (no internal_note, created_by, …)
POST /:token/view                 marks viewed; skipped when req.user is set
POST /:token/sign                 { signer_name, signature_png, consent, version }
GET  /:token/files/:fileId        attachments of that quote only (with attachments)
GET  /:token/branding/:kind       logo / signature
```

**The link's address** is `PUBLIC_BASE_URL` when that is set (for a client hostname kept outside Cloudflare Access), and otherwise the address the app was opened at, from the request's `Origin`.

**The signed snapshot** holds the quote's client-facing fields, the lines and totals, the colours, and the band's signature as a data URL, so the record does not depend on a branding image that may be replaced later. The client's own signature stays in `signature_png`. A signed link is always shown from the snapshot.

**Checks on sign.** The server rejects the request unless all of these hold:

- The status is `sent` or `viewed`, and the quote has not expired.
- `version` matches `updated_at`.
- `signer_name` is not blank.
- `consent === true`.
- `signature_png` is a `data:image/png;base64,` string under 300 KB.

It then records `CF-Connecting-IP`, the user agent and the time, and freezes the snapshot with its SHA-256. A second sign returns `409`.

**Rate limits:** `view` and `sign` are limited per IP, reusing the login limiter's approach.

**Headers:** public responses send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`, so the token does not leak through referrers or into search.

**Rendering:** all client text is rendered by React as text; `dangerouslySetInnerHTML` is never used. Terms and intro use `white-space: pre-line`.

**Tokens:** 32 random bytes, base64url. Stored in plain text because the team needs to copy the link again. "חידוש קישור" (renew link) revokes the old one.

## Files

- **Where files live:** in the database, as BLOBs in `band_quote_files`. This changes the first draft of this design, which kept them on disk under `DATA_DIR/uploads/`.
  - **Why:** `deploy/backup.sh` copies the database file and nothing else. A logo or signature on disk would be the one thing a restore came back without.
  - **What it costs:** nothing that matters at this size. A logo or a signature is tens of KB, and SQLite stores a few MB per BLOB without trouble.
  - **What it saves:** there are no orphan files, no paths to sanitize, and nothing to add to the backup.
- **Branding images:**
  - The logo and the signature are each one row with no quote, pointed at by a setting.
  - Replacing one inserts the new row and deletes the old one in a single transaction.
  - They are served at `/api/moonlight/quotes/branding/:kind?v=<file id>`. Because the id is in the address, the image is cached forever and still never shown stale after a replacement.
- **Limits:**
  - Images may be PNG, JPG or WebP, up to 5 MB.
  - Attachments (later) may also be PDF, up to 10 MB.
  - The server reads the type from the file's leading bytes and ignores the header the browser sent.
  - SVG is refused, because it is a document that can carry script and it would be served from the app's own origin.
- **Deleting:** removing a file, or the quote that holds it, deletes its row.

## Branding

All of this lives in the quote settings, under "מיתוג" and "חתימה".

**Logo**
- The logo replaces the brand name in the quote's header.
- It sits at the right, in the middle or at the left (`quote_logo_position`). At a side, the quote's number and date take the corner across from it. In the middle, they are one line centred under it, and the title follows it to the middle. The email's header takes the same position.

**Colours**
- There are two colours. The **header** colour fills the quote's top. The **accent** colours the section headings and the total.
- Seven ready-made palettes are offered, and two colour pickers accept any colour.
- No choice can make a quote unreadable:
  - The header's text is whichever of white or near-black has the higher contrast against the chosen colour.
  - The accent is darkened only as far as it takes to reach 4.5:1 on white (WCAG AA). A pale gold still reads.

**Signature**
- It is shown at the end of every quote, at the far side, with the name under it and "בשם {brand}".
- The near side is left free for the client's signature in phase 3.
- **Upload:** the owner photographs a pen signature on paper. The browser then processes the photo before uploading it:
  - The paper's shade is read from the photo (the 60th percentile of brightness).
  - Anything clearly darker than the paper is kept as ink, with a soft edge so the strokes stay smooth, and the paper becomes transparent.
  - The result is cropped to the ink and saved as a PNG.
  - Drawing through a canvas also converts an iPhone HEIC photo into something the server accepts.
- **Keeping the photo as taken:** a switch shows the photo before and after background removal. If you turn it off, the photo is uploaded as it is, still as a PNG.

## Frontend

**Routes** (`src/main.tsx`):

- `/moonlight/quotes/new` and `/moonlight/quotes/:id` go inside `Layout`, before `/moonlight/:tab`.
- `/moonlight/quotes` is a new `Tab` in `Moonlight.tsx`.
- `/q/:token` sits outside `Layout`, like `/login`, and needs no login.

**Nav:** add `{ to: '/moonlight/quotes', label: 'הצעות מחיר', icon: FileSignature }` to `moonNav`, plus a `moonMobile` slot or the «עוד» menu.

**QuotesTab** (`src/pages/moonlight/QuotesTab.tsx`, based on `SuppliersTab.tsx`):

- Stat cards:
  - Open quotes and their value.
  - Signed this year and its value.
  - Conversion rate.
  - Expiring within 3 days.
- `DataTable` columns: number, client, event date and type, total, status, created by.
- Row actions: edit, copy link, WhatsApp, duplicate, cancel, delete.
- Filters: search, status, period.
- Buttons beside "+ הצעה חדשה": "תבניות" (list, open, set default, delete), "חבילות" (package CRUD in a `Modal`) and "הגדרות" (brand name, contact, validity, VAT mode; the WhatsApp template arrives with the client link).

**QuoteEditor** (`src/pages/moonlight/QuoteEditor.tsx`):

- Two panes: the form on one side, and a live `<QuoteDocument>` preview on the other. On mobile these become toggled tabs.
- Form sections:
  - Client and event, with the show suggestion.
  - Items: "הוספה מחבילה" or a free line, reordered with up/down buttons.
  - Discount and the VAT mode.
  - Intro and terms, both filled from the template the quote was made from.
  - Attachments.
  - Validity.
  - Internal note.
- Actions: שמירה, שליחה (opens the share dialog), and **תצוגה מקדימה**.
  - The preview saves unsaved changes first, then opens `/moonlight/quotes/:id/preview`: the quote alone, outside the app's shell, as the client's link will show it.
  - On a computer it starts in a phone-width frame, since most clients read it from WhatsApp, with a switch to the wide version.
  - `QuoteDocument` sizes itself with a container query, so the frame, the editor's side panel and a real phone all get the same layout.
  - On a phone this is the editor's only preview; on a wide screen the live side preview stays.

**QuoteDocument** (`src/quotes/QuoteDocument.tsx`) is the single renderer of what the client sees, used by the preview and the public page alike. What is previewed is therefore what gets signed.

- A quote is dated the day it was made, in Israel, under its number.
- A line at no charge reads «כלול». A template's first line, priced in each quote, reads «נקבע בכל הצעה».
- The intro and the terms are laid out from plain text. A short line ending in a colon is a heading, and lines starting with «•» or «-» are a list. Every piece is still rendered as text.

**Public page** (`src/pages/QuotePublic.tsx`) is built mobile-first, because clients open it from WhatsApp.

- Section order:
  - Hero: cover image, logo, brand name, title, "עבור {client}", event date and place, and a validity pill.
  - Intro.
  - Items and totals.
  - Attachments.
  - Terms.
  - Signature form: full name, canvas, consent checkbox, "אני מאשר/ת את ההצעה".
  - Contact footer, with a WhatsApp button to the contact person.
- Canvas: uses Pointer Events and scales by `devicePixelRatio`, fixing the original's touch and hi-DPI bugs.
- After signing: a thank-you state and "שמירה כ-PDF", which calls `window.print()`. The `@media print` layout includes the signature, signer name and time.
- Other states: expired, cancelled and already signed, the last one showing the signed copy.
- The page sets `data-ws="moon"` for the Moonlight palette.

**Share dialog** (`QuoteShareModal.tsx`), opened by «שליחה ללקוח» in the editor:

- Copy link, and open it the way the client will (a logged-in visit is not counted as a view).
- **וואטסאפ** opens `https://wa.me/972XXXXXXXXX?text=…`. The phone is normalized from however it was typed. With no phone it falls back to `https://wa.me/?text=…`, and WhatsApp asks who to send to.
- **אימייל** opens the device's mail app (`mailto:`), and **Gmail** opens Gmail's compose window. Both are addressed to the quote's client email when there is one, with the subject from `quote_email_subject`.
- The email is HTML (`src/quotes/quoteEmail.ts`): the band's header, the message, a card with the title, date, place and total, and a button to the link. A compose link can carry only plain text, so the click puts the email on the clipboard as rich text and opens the compose window with an empty body to paste it into. The line the link is on in the message becomes the button, in that line's words. If the browser refuses the copy, the window opens with the plain message, as before.
- The dialog previews the email («איך המייל ייראה»). Its logo is the link's own public address, so the client's mail app loads it without a login.
- The message comes from `quote_message_template`, with `{client_name}`, `{title}`, `{event_date}`, `{valid_until}`, `{link}`, `{contact_name}` and `{quote_number}` filled in. It can be edited in the dialog for one send, and the links follow the edit.
- «קישור חדש במקום הזה» replaces the token, and the old link stops working. A signed quote keeps its link, since it is the client's copy.

**Follow-ups** (`quoteFollowUps`, part of `bandFollowUps`), on the Moonlight summary and in the owner's inbox:

- Newly signed quotes, until someone in the band opens the quote (`signed_seen_at`, set by `GET /:id`).
- Signed quotes with no show: several on the date, none yet from the calendar, a failure, or the show deleted since.
- Signed quotes whose calendar event is still titled «אופציה».
- Amount disagreements of more than ₪1 before VAT between a signed quote and its show.

## Deployment note: Cloudflare Access

`deploy/README.md` §7 marks Access as optional, and it could not be checked from here. If it is enabled on `im-tools.org`, add a **Bypass** policy for `/q/*`, `/api/public/*` and `/assets/*` (the SPA bundle the public page needs). Otherwise clients hit the Access login screen. An alternative is a separate hostname on the same tunnel, such as `quotes.im-tools.org`, left outside Access.

## Testing

There is no test runner today; CI is `tsc --noEmit` plus `vite build`. The logic that matters is pure:

- Totals in both VAT modes, with discount.
- Numbering.
- Status guards and derived expiry around midnight in Israel.
- Sign validation.
- The sign-to-show decision for 0, 1 or several shows on the date.

Proposal: add `node --test` via `tsx` for `server/quotes.ts` only, and run it in CI. The UI is verified by running the app.

## Build order (four PRs)

1. **Foundation**
   - Tables, `server/quotes.ts` and the authenticated API.
   - `QuotesTab`, `QuoteEditor` and `QuoteDocument` preview.
   - Templates and quick create.
   - Packages and settings, and band access.
   - Unit tests.
2. **Files**
   - Done ahead of the rest: `server/quoteFiles.ts`, the logo, the colours and the owner's signature.
   - Per-quote attachments remain. They use the same table and the same checks, so the backup needs no change.
3. **Client link** — done
   - Token and public API.
   - `/q/:token` page, signature, view tracking and print layout.
   - Share dialog with WhatsApp and email.
4. **Sign becomes a show** — done, through the calendar
   - Linking logic and the editor's show suggestion.
   - `ShowDetail` link and summary follow-ups.

## What we deliberately do not port

**Security**

- The public link was the guessable `Q-<timestamp>`, and the `Quote` entity was publicly writable.
  - Now there is a random token, a narrow public API, and signing validated on the server.
- `signature_ip` was never captured, and the PDF function had no authentication.

**Quote states**

- `require_signature` was ignored, so drafts could be signed.
- `awaiting_signature` and `expired` were never set, and the dashboard's "expired" count was always 0.
- Resend flipped signed quotes back to `sent`.
- Duplicating a quote copied its signature and PDF.

**Views**

- Viewing a quote as the business counted as a client view.

**Dates and money**

- Expiry was compared in UTC, so quotes expired on the morning of their last day.
- VAT defaulted to 17%, and `|| 17` turned 0% VAT into 17%.
- The discount could exceed the subtotal.
- A currency could be chosen per item but was ignored in the totals.

**Code and UI quality**

- Three copies of the send-email HTML, and email templates only half implemented.
- Garbled helper texts in `CreateQuote.jsx`.
- Unused dependencies: Stripe, three, leaflet, jspdf, html2canvas and others.
