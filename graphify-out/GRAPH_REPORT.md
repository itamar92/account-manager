# Graph Report - account-manager  (2026-11-19)

## Corpus Check
- 203 files · ~270,400 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 5, .csv 3, .example 2)

## Summary
- 2241 nodes · 6093 edges · 108 communities (88 shown, 20 thin omitted)
- Extraction: 97% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 151 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1bfb3c61`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- main
- react
- shared.ts
- routes.ts
- quoteCalendar.ts
- quoteEmail.ts
- overview.ts
- api.ts
- nis
- collect_bills.py
- server/quotes.ts
- quoteLink.test.ts
- Vendor-Specific Invoice Parsers
- assignments.ts
- moonlight.ts
- supplierNames.ts
- MorningError
- MoneyCalculator.tsx
- supplierPayments.ts
- Business Automation Architecture (n8n + Sheets + Cowork)
- Expense Inventory 2026 (as of 2026-04-16)
- agentConfig.ts
- metaSync.ts
- quoteLink.ts
- reports.ts
- getSetting
- morningClient.ts
- campaignAdvisor.ts
- Button
- ticketFinder.ts
- im-tools.org Deployment Guide
- server.ts
- morningExpenses.ts
- annualReport.ts
- calendarSync.ts
- Account Manager Web App
- tax-compliance Agent
- QuoteShareModal.tsx
- formParser.ts
- ui.tsx
- morningSync.ts
- quoteMath.ts
- creditPoints.ts
- dependencies
- quoteShow.ts
- Category Definitions
- package.json
- מה דורש טיפול Inbox (/api/inbox)
- Usage Guide - Invoice Expert with Raw Data
- Invoice Expert Skill - Quick Start
- compilerOptions
- Moonlight Quotes Design
- metaClient.ts
- MorningIssueModal.tsx
- 4. The how — decisions made
- Revenue Document Types (docTypes.ts: 305, 320)
- Israeli Bank Connector
- expense-status-probe.ts
- invoiceService.ts
- Deploy workflow (production)
- db.ts
- parseCarrefourGlobalInvoice
- SimpleInvoiceExtractor
- quoteCalendar.test.ts
- business.ts
- מחבר בנקאות ישראלי
- devDependencies
- scripts
- MCP Server (/mcp) Read-only Access
- ref_fs
- mcp-bridge.mjs
- CLAUDE.md
- parse10tenInvoice
- Invoice Expert - מומחה חשבוניות
- parseGinzburgMusicInvoice
- parseLivePlayInvoice
- n8n Integration Guide - Invoice Expert
- parseTzmigeiShabtaiInvoice
- prepareSignature
- setup-claude-agent.sh
- App Favicon (favicon.svg)
- claude-agent.sh
- backup.sh
- keepalive.sh
- fixedAssets.ts
- File Structure (new repo)
- agentClient.ts
- db
- Supported Israeli Banks and Credit Card Companies
- getVatPercent
- account-manager
- parseMetaAdsInvoice
- Invoice Collector Implementation Plan
- quoteTemplates.ts
- invoice-collector v1 — decisions I made, and the go-live checklist
- invoice-intake.md
- payables.md
- requirements.txt
- .claude/CLAUDE.md
- quoteShow.test.ts

## God Nodes (most connected - your core abstractions)
1. `get()` - 84 edges
2. `nis()` - 83 edges
3. `Button()` - 78 edges
4. `post()` - 67 edges
5. `getSetting()` - 58 edges
6. `Input()` - 55 edges
7. `uuid()` - 54 edges
8. `react` - 53 edges
9. `Modal()` - 50 edges
10. `Empty()` - 49 edges

## Surprising Connections (you probably didn't know these)
- `Job` --references--> `Clients()`  [INFERRED]
  .claude/agents/bank-reconciler.md → app/src/pages/Clients.tsx
- `Job` --references--> `Expenses()`  [INFERRED]
  .claude/agents/invoice-intake.md → app/src/pages/Expenses.tsx
- `Global Constraints` --references--> `Settings()`  [INFERRED]
  docs/superpowers/plans/2026-11-18-invoice-collector.md → app/src/pages/Settings.tsx
- `Task 8: Validation and naming` --references--> `Settings()`  [INFERRED]
  docs/superpowers/plans/2026-11-18-invoice-collector.md → app/src/pages/Settings.tsx
- `Task 20: account-manager integration (in the account-manager repo)` --references--> `requireOwner()`  [INFERRED]
  docs/superpowers/plans/2026-11-18-invoice-collector.md → app/server/auth.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **HaTeatron HaIvri studio-hour show-prep projects** — havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_hateatron_haivri_association, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_studio_hour_sku, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_schlager_gvarti_hanaava_computer_prep, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis_ofra_musical_computer_prep, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis_arik_einstein_project [EXTRACTED 1.00]
- **Hebrew Theatre ₪3,823 split payment across two studio-hour receipts** — havila_2026_01_to_2026_04_invoices_issued_hebrew_theatre_split_transfer_3823, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60221_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_client_hebrew_theatre, havila_2026_01_to_2026_04_invoices_issued_studio_hour_rate_180, havila_2026_01_to_2026_04_invoices_issued_whole_shekel_rounding [EXTRACTED 1.00]
- **Moonlight Coldplay-tribute revenue documents and gigs** — havila_2026_01_to_2026_04_invoices_issued_moonlight_coldplay_tribute, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_15_type300_num40223_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_23_type320_num60219_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_04_type320_num60222_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_music_city_2025_12_25, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_jems_petah_tikva, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_haifa_2026_01_07, havila_2026_01_to_2026_04_invoices_issued_vat_inclusive_gross_pricing [EXTRACTED 1.00]
- **Moonlight Coldplay tribute revenue documents, January 2026** — havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis_moonlight_coldplay_tribute_show, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60213_לאן_משרד_כרטיסים_בעמ_leanltd_13748nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_22_type300_num40218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_28_type320_num60216_עיריית_תל_אביב_יפו_16520nis [EXTRACTED 1.00]
- **Deduction Ratio Encodings Across Sources** — app_readme_expense_recognition_rates, graphify_out_converted_דוח_שנתי_עוסק_זעיר_2025_eea5449b_expense_recognition_table, docs_data_schema_expenses_tab, docs_architecture_yearly_report_projection [INFERRED 0.75]
- **Freeze History Once Money or Consent Changes Hands** — docs_quotes_design_signed_snapshot, app_readme_settled_show_freeze, app_readme_campaign_figure_lock, app_readme_producer_fee, docs_quotes_design_quote_money [INFERRED 0.75]
- **Hardening of AI Agent Access (read-only, no side effects)** — app_readme_mcp_server, app_readme_agent_over_ssh, deploy_readme_agent_tool_hardening, deploy_readme_aiagent_forced_command, docs_architecture_security_rules [INFERRED 0.85]
- **Billing lifecycle: transaction account (300) settled by tax invoice/receipt (320)** — havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis_doc_type_300_transaction_account, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis_doc_type_320_tax_invoice_receipt, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_28_type320_num60216_עיריית_תל_אביב_יפו_16520nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_22_type300_num40218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40221_מירי_פרלמן_בע_מ_1770nis [INFERRED 0.85]
- **Deal→Receipt closings (300→320), Jan–Mar 2026** — havila_2026_01_to_2026_04_invoices_issued_deal_to_receipt_closing_pattern, havila_2026_01_to_2026_04_invoices_issued_doc_type_300_transaction_account, havila_2026_01_to_2026_04_invoices_issued_doc_type_320_tax_invoice_receipt, havila_2026_01_to_2026_04_invoices_issued_2026_01_31_type300_num40222_אודי_קרני_3304nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60217_אודי_קרני_6254nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_15_type300_num40223_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_23_type320_num60219_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60221_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_04_type320_num60222_זאפה_ניוקו_בע_מ_חיפה_26180nis [INFERRED 0.95]

## Communities (108 total, 20 thin omitted)

### Community 0 - "main"
Cohesion: 0.05
Nodes (90): Job, Rules, Job, Tone rules for drafts, Each run, Read the app before you read anything else, Rules, temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11) (+82 more)

### Community 1 - "react"
Cohesion: 0.06
Nodes (79): QuoteTotals, AuthContext, AuthContextType, useAuth(), User, Login(), Check(), QuoteCalendarModal() (+71 more)

### Community 2 - "shared.ts"
Cohesion: 0.06
Nodes (63): Props, CampaignAnalysisTab(), EFFORTS, Props, SEVERITIES, VERDICTS, when(), Working() (+55 more)

### Community 3 - "routes.ts"
Cohesion: 0.08
Nodes (40): annualReport, assignmentsForEvent(), missingRoles(), lastReport(), DOC_TYPE_LABELS, isRevenueDoc(), RECEIVABLE_DOC_TYPES_SQL, REVENUE_DOC_TYPES_SQL (+32 more)

### Community 4 - "quoteCalendar.ts"
Cohesion: 0.15
Nodes (31): CalendarAttendee, CalendarError, CalendarEvent, CalendarSummary, EventInput, getAccessToken(), getEventById(), insertEvent() (+23 more)

### Community 5 - "quoteEmail.ts"
Cohesion: 0.26
Nodes (15): contrast(), luminance(), PALETTES, readableOnWhite(), rgb(), textOn(), toHex(), cardRow() (+7 more)

### Community 6 - "overview.ts"
Cohesion: 0.13
Nodes (28): change(), ClientShare, clientShares(), DEFAULT_RECOGNITION_RATES, ExpenseBasis, expensesByMonth(), isExpenseBasis(), iso() (+20 more)

### Community 7 - "api.ts"
Cohesion: 0.07
Nodes (55): dayShort(), monthLabel(), monthName(), monthSlash(), plain(), postFile(), SHORT_MONTHS, signedPercent() (+47 more)

### Community 8 - "nis"
Cohesion: 0.10
Nodes (41): nis(), nisExact(), shekels(), OverviewTooltip(), PerShowChart(), ReconciliationCard(), Row(), DivisionTable() (+33 more)

### Community 9 - "collect_bills.py"
Cohesion: 0.06
Nodes (11): analyze_transactions(), categorize_transaction(), format_analysis(), generate_example_transactions(), main(), download_pdf(), get_token(), ensure_dir() (+3 more)

### Community 10 - "server/quotes.ts"
Cohesion: 0.07
Nodes (57): requireOwner(), ownerForSignature(), quoteRouter, addDays(), BuiltinKey, builtinTemplates(), cancelQuote(), clampDays() (+49 more)

### Community 11 - "quoteLink.test.ts"
Cohesion: 0.11
Nodes (7): CARD, jpeg, png, webp, META, KW, EmailCard

### Community 12 - "Vendor-Specific Invoice Parsers"
Cohesion: 0.07
Nodes (29): 1. Invoice Arrives, 2. Vendor Identification, 3. Parser Selection, Adding a New Vendor, Best Practices, Common Parsing Patterns, Contributing, Date Extraction (+21 more)

### Community 13 - "assignments.ts"
Cohesion: 0.13
Nodes (27): applyDefaultAmount(), ASSIGNMENT_ROLES(), attendeeEmails(), autoAssignAll, autoAssignEvent(), defaultAmount(), deleteSupplier, listSuppliers() (+19 more)

### Community 14 - "moonlight.ts"
Cohesion: 0.10
Nodes (43): setOverride(), adjustBandFundActual(), ALWAYS_SETTLED, backfillEventShares(), backfillMoonlight(), bandMemberByKey(), BUSINESS_TYPES, BusinessType (+35 more)

### Community 15 - "supplierNames.ts"
Cohesion: 0.14
Nodes (37): keyOf(), listPayees(), memberPayee(), Payee, payeeColumns(), payeeKey(), payeeRef(), payeesByKey() (+29 more)

### Community 16 - "MorningError"
Cohesion: 0.26
Nodes (13): documentUrl(), MorningError, buildMorningDraft(), buildPendingMorningDraft(), issueDocument(), issueWorksToMorning(), loadClientForIssue(), loadInvoiceForPush() (+5 more)

### Community 17 - "MoneyCalculator.tsx"
Cohesion: 0.10
Nodes (31): bizMobile, bizNav(), initials(), Layout(), Logo(), moonMobile, moonNav, NavGroup (+23 more)

### Community 18 - "supplierPayments.ts"
Cohesion: 0.12
Nodes (34): PayeeKind, SIMILAR_ENOUGH, AssignmentRole, availableOf(), deletePayment, documentedTotal(), getPayment(), hasDocs() (+26 more)

### Community 19 - "Business Automation Architecture (n8n + Sheets + Cowork)"
Cohesion: 0.16
Nodes (27): bank-monitor Agent, Four-Week Automation Build Order, Business Automation Architecture (n8n + Sheets + Cowork), Dropbox Canonical Filing Convention, invoice-intake Agent, Morning / Green Invoice Accounting System, payables Agent, receivables Agent (+19 more)

### Community 20 - "Expense Inventory 2026 (as of 2026-04-16)"
Cohesion: 0.33
Nodes (5): Expense Inventory 2026 (as of 2026-04-16), Gaps to Fill, P&L Draft (YTD 2026), Summary by Category, VAT Input (mas tsumos) Check — Mar-Apr period

### Community 21 - "agentConfig.ts"
Cohesion: 0.14
Nodes (24): AgentConfigError, AgentConfigPatch, agentConfigView(), DEFAULT_COMMAND, DEFAULT_PORT, DEFAULT_TIMEOUT_MS, env(), Field (+16 more)

### Community 22 - "metaSync.ts"
Cohesion: 0.17
Nodes (23): getMetaCurrencyRate(), getMetaSyncDays(), isMetaConfigured(), adAnalysis(), AdAnalysisRow, applyCampaignSpend(), ApplyResult, attributedSpendByEvent() (+15 more)

### Community 23 - "quoteLink.ts"
Cohesion: 0.14
Nodes (31): brandingImage(), bandSignatureDataUrl(), CLIENT_FIELDS, documentOf(), EmailCard, fileId(), liveBranding(), newToken() (+23 more)

### Community 24 - "reports.ts"
Cohesion: 0.13
Nodes (27): bracketTax(), dueDate(), emptyRow(), ExpenseBasis, expenseDateSql(), getVatFrequency(), HEB_MONTHS, incomeTaxReport (+19 more)

### Community 25 - "getSetting"
Cohesion: 0.20
Nodes (18): correctSwappedLocalDocTypes(), getSetting(), setSetting(), uuid(), backfillFundTransfers(), BrandingKind, brandingUrl(), FileError (+10 more)

### Community 26 - "morningClient.ts"
Cohesion: 0.18
Nodes (18): createDocument(), CreateDocumentInput, DocumentPayment, getDocument(), getExpense(), getToken(), listClients(), MorningClassification (+10 more)

### Community 27 - "campaignAdvisor.ts"
Cohesion: 0.20
Nodes (20): AgentError, AdviserContext, analyzeCampaigns(), appendChat(), ask(), BAND_BRIEF, buildContext(), buildPrompt() (+12 more)

### Community 28 - "Button"
Cohesion: 0.10
Nodes (57): api(), del(), post(), put(), AgentSettings(), AgentView, FromEnv(), ProfileModal() (+49 more)

### Community 29 - "ticketFinder.ts"
Cohesion: 0.05
Nodes (77): addLinkByHand(), assertPublicUrl(), attr(), Availability, availabilityOf(), CalendarGig, calendarLinks(), canonicalOf() (+69 more)

### Community 30 - "im-tools.org Deployment Guide"
Cohesion: 0.13
Nodes (19): Settings → סוכן AI (AGENT_SSH_* fallback), יועץ קמפיינים AI Campaign Advisor, CI Workflow (tsc lint, vite build, node tests), SSH Host Key Pinning, Secret Encryption (AES-256-GCM, secret.key), SQLite Database (account-manager.db, better-sqlite3), am-data Volume, app Service (expose 3000) (+11 more)

### Community 31 - "server.ts"
Cohesion: 0.06
Nodes (39): app, clearLoginAttempts(), clientIp(), createSession(), currentSessionToken(), destroySession(), Express, loadUser() (+31 more)

### Community 32 - "morningExpenses.ts"
Cohesion: 0.15
Nodes (20): expenseClassifications(), MorningExpense, category(), docType(), expenseCategories(), ExpenseFilters, ExpenseMoney, ExpensePullResult (+12 more)

### Community 33 - "annualReport.ts"
Cohesion: 0.17
Nodes (22): AllowedFigure, annualAssessment, AnnualBasis, AnnualDeadline, annualOutlook, defaultFileBy(), emptyProfile(), getProfile() (+14 more)

### Community 34 - "calendarSync.ts"
Cohesion: 0.09
Nodes (48): eventDate(), listEvents(), CalendarRule, cleanTitle(), createRule(), deleteOverride(), deleteRule(), escapeRegExp() (+40 more)

### Community 35 - "Account Manager Web App"
Cohesion: 0.08
Nodes (26): Heebo Font (Google Fonts), index.html SPA Entry (Hebrew RTL), Account Manager Web App, Calendar Manual Overrides (exclude / include), Calendar Rule Preview (dry run), Google Calendar Sync Rules, Campaign → Show Mapping (weights, suggestions), Meta Ads Sync (+18 more)

### Community 36 - "tax-compliance Agent"
Cohesion: 0.12
Nodes (23): הוצאות Expenses Page (read-only Morning mirror), מס הכנסה Income Tax Estimate, monthlyPnl Shared P&L Query (ExpenseBasis), Period Filter (dateRange), דוחות Reports Page, tax_filings (דווח / שולם ticks), TAX_RATES (server/reports.ts), דוח מע"מ VAT Report (+15 more)

### Community 37 - "QuoteShareModal.tsx"
Cohesion: 0.26
Nodes (12): DEFAULT_MESSAGE, DEFAULT_SUBJECT, gmailUrl(), mailtoUrl(), MESSAGE_PLACEHOLDERS, MessageFields, plainEmail(), whatsappUrl() (+4 more)

### Community 38 - "formParser.ts"
Cohesion: 0.12
Nodes (18): AnnualProfile, CODES, codesIn(), CodeSpec, detectKind(), detectYear(), extractLines(), FormKind (+10 more)

### Community 39 - "ui.tsx"
Cohesion: 0.11
Nodes (48): get(), AuthProvider(), Clients(), emptyForm, initials(), Expenses(), Figure(), Inbox() (+40 more)

### Community 40 - "morningSync.ts"
Cohesion: 0.11
Nodes (29): ACCOUNTING_DOC_TYPES, ACCOUNTING_DOC_TYPES_SQL, CREDIT_DOC_TYPES, ISSUABLE_DOC_TYPES, issuableDocTypeOptions(), PAYMENT_DOC_TYPES, PAYMENT_TYPE, PAYMENT_TYPE_LABELS (+21 more)

### Community 41 - "quoteMath.ts"
Cohesion: 0.36
Nodes (8): amount(), computeTotals(), DEPOSIT_PLACEHOLDER, depositAmount(), QuoteLine, QuoteLineInput, round2(), show

### Community 42 - "creditPoints.ts"
Cohesion: 0.16
Nodes (17): childPoints(), clearCreditStatus(), creditBreakdown, CreditChild, CreditLine, CreditStatus, dischargePoints(), EMPTY_STATUS (+9 more)

### Community 43 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, clsx, date-fns, dotenv, express, lucide-react, pdfjs-dist, react (+11 more)

### Community 44 - "quoteShow.ts"
Cohesion: 0.19
Nodes (17): isOptionTitle(), OPTION_PREFIX, withoutOption(), amountsDisagree(), claimedByAnother(), fillAmounts(), linkQuoteToShow(), linkSignedQuote() (+9 more)

### Community 45 - "Category Definitions"
Cohesion: 0.15
Nodes (12): Categorization Tips, Category Definitions, Education (Chinuch), Entertainment (Bilui), Groceries (Mazon), Healthcare (Briut), Housing (Diur), Insurance (Bituach) (+4 more)

### Community 46 - "package.json"
Cohesion: 0.09
Nodes (23): name, private, type, version, start(), Task 1: Repo scaffold, DB, settings, secrets, better-sqlite3, date-fns (+15 more)

### Community 47 - "מה דורש טיפול Inbox (/api/inbox)"
Cohesion: 0.25
Nodes (7): סקירה Dashboard Overview (overview.ts), Expense Recognition Rates (expense_recognition_rates), מה דורש טיפול Inbox (/api/inbox), Quote vs Show Amount Disagreement, Quote Follow-ups (quoteFollowUps), Quote Lifecycle (draft → sent → viewed → signed), Expense Categories & Recognition % (2025)

### Community 48 - "Usage Guide - Invoice Expert with Raw Data"
Cohesion: 0.07
Nodes (29): 1. Import Workflow, 2. Update Path, 3. Test, 4. Check Output, Benefits Summary, Complete n8n Workflow Example, Different Vendor Examples, Example 1: Partner (פרטנר) (+21 more)

### Community 49 - "Invoice Expert Skill - Quick Start"
Cohesion: 0.07
Nodes (26): 1. Interactive Use in Claude Code, 2. n8n Automation - Text Input, 3. n8n Automation - PDF File with Vision, 4. n8n Automation - SSH/Execute Command, Adding New Vendors, Benefits, Common Issues, Cost Optimization Tips (+18 more)

### Community 50 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution (+7 more)

### Community 51 - "Moonlight Quotes Design"
Cohesion: 0.12
Nodes (20): Cloudflare Access with Bypass Paths, band_quote_files Table (BLOBs), band_quote_items Table, band_quote_packages Table, band_quotes Table, Quote Branding (logo, colours, signature), Built-in Templates (Coldplay tribute, Eilat by car / by plane), Deposit Percent ({deposit}) (+12 more)

### Community 52 - "metaClient.ts"
Cohesion: 0.23
Nodes (13): accessToken(), adAccountId(), fetchAccount(), fetchCampaigns(), fetchDailyCampaignInsights(), graph(), graphPaged(), MetaAccount (+5 more)

### Community 53 - "MorningIssueModal.tsx"
Cohesion: 0.25
Nodes (14): Business, computeDueDate(), docDate(), DocumentPreview(), Draft, DraftLine, Form, he() (+6 more)

### Community 54 - "4. The how — decisions made"
Cohesion: 0.07
Nodes (26): 1. Intent and why, 2. Goals, non-goals, anti-goals, 3. Constraints, 4.10 Integration with account-manager, 4.11 Packaging, 4.12 Morning: three ways in, best one first, 4.13 First-run guide, 4.1 Pipeline per invoice (+18 more)

### Community 55 - "Revenue Document Types (docTypes.ts: 305, 320)"
Cohesion: 0.20
Nodes (10): פרטי העסק Business Details Letterhead, Revenue Document Types (docTypes.ts: 305, 320), Expense Status Audit & expenses:probe, expenses.raw Payload Retention, Morning Expenses Sync (expenses-sync), Morning (Green Invoice) Integration, Two-Step Morning Issue Dialog (morning-draft), Morning Pull Sync (/integrations/morning/sync) (+2 more)

### Community 56 - "Israeli Bank Connector"
Cohesion: 0.10
Nodes (20): Bundled Resources, Error: "2FA required", Error: "Missing credit card transactions", Error: "Scraper timeout", Example 1: Monthly Spending Summary, Example 2: Subscription Audit, Example 3: Tax Expense Export, Examples (+12 more)

### Community 57 - "expense-status-probe.ts"
Cohesion: 0.25
Nodes (8): audit, full, total, isMorningConfigured(), expensesStatus(), expenseStatusAudit, morningStatus(), dotenv

### Community 58 - "invoiceService.ts"
Cohesion: 0.24
Nodes (11): DOC_TYPE, createInvoice(), CreateInvoiceInput, deleteInvoice(), getInvoice(), LineItemInput, LOCAL_NUMBER_PREFIX, nextInvoiceNumber() (+3 more)

### Community 59 - "Deploy workflow (production)"
Cohesion: 0.33
Nodes (10): better-sqlite3, deploy/Dockerfile (Node 22 app image), CI workflow (lint & build), app lint & build job (npm ci -> lint -> test -> build on Node 22), Deploy workflow (production), Container HEALTHCHECK readiness wait, Production environment (im-tools.org), Deploy secrets (DEPLOY_HOST, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, DEPLOY_USER) (+2 more)

### Community 60 - "db.ts"
Cohesion: 0.16
Nodes (10): __dirname, hashPassword(), seedDefaultCalendarRules(), MOONLIGHT_EVENT_EXPENSES, MOONLIGHT_GENERAL_EXPENSES, MOONLIGHT_INCOME, __dirname, parseCsv() (+2 more)

### Community 61 - "parseCarrefourGlobalInvoice"
Cohesion: 0.22
Nodes (7): Carrefour - Global Retail K.Y. (M.D.) Ltd, Hod HaSharon branch (vendor), parseCarrefourGlobalInvoice(), extractData(), formatDate(), parseCarrefourInvoice(), extractData(), formatDate()

### Community 63 - "quoteCalendar.test.ts"
Cohesion: 0.25
Nodes (4): events, fake, MEMBERS, requests

### Community 64 - "business.ts"
Cohesion: 0.27
Nodes (9): BUSINESS_TYPE_LABELS, BusinessDetails, BusinessInput, Field, FIELDS, getBusinessDetails(), setBusinessDetails(), settingKey() (+1 more)

### Community 65 - "מחבר בנקאות ישראלי"
Cohesion: 0.10
Nodes (20): דוגמאות, דוגמה 1: סיכום הוצאות חודשי, דוגמה 2: ביקורת מנויים, דוגמה 3: ייצוא הוצאות למס, הוראות, חומרי עזר, מחבר בנקאות ישראלי, מלכודות נפוצות (+12 more)

### Community 66 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/better-sqlite3, @types/express, @types/node, @types/react, @types/react-dom, typescript

### Community 67 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, expenses:probe, lint, start, test

### Community 68 - "MCP Server (/mcp) Read-only Access"
Cohesion: 0.29
Nodes (5): X-API-Key Authentication, External API (/api/v1), mcp-bridge.mjs Claude Desktop Relay, MCP Server (/mcp) Read-only Access, MCP Tool List (mcpTools.ts)

### Community 69 - "ref_fs"
Cohesion: 0.17
Nodes (7): fs, parser, result, text, temp-invoice-text.txt (Weezmo fuel receipt OCR sample), Weezmo digital fuel receipt (ENI Mobile / מנטה קמעונאות, 23/01/25, 245.19 NIS), parseDelekOCRInvoice()

### Community 70 - "mcp-bridge.mjs"
Cohesion: 0.43
Nodes (5): forward(), send(), sendError(), TIMEOUT_MS, Task 12: Morning destination (three modes)

### Community 73 - "Invoice Expert - מומחה חשבוניות"
Cohesion: 0.10
Nodes (19): category, description, finalName, Invoice Expert - מומחה חשבוניות, invoiceType, total, דוגמאות לפרסרים קיימים, דוגמה (+11 more)

### Community 74 - "parseGinzburgMusicInvoice"
Cohesion: 0.50
Nodes (3): parseGinzburgMusicInvoice(), cleanText(), extractData()

### Community 75 - "parseLivePlayInvoice"
Cohesion: 0.50
Nodes (3): parseLivePlayInvoice(), extractData(), formatDate()

### Community 76 - "n8n Integration Guide - Invoice Expert"
Cohesion: 0.11
Nodes (18): Complete n8n Workflow Examples, Cost Comparison, Extract JSON from CLI Output, Media Types for Vision, n8n Integration Guide - Invoice Expert, Option 1: Claude API via HTTP Request (Recommended), Option 2: Claude Code CLI via Execute Command, Prerequisites (+10 more)

### Community 77 - "parseTzmigeiShabtaiInvoice"
Cohesion: 0.60
Nodes (4): parseTzmigeiShabtaiInvoice(), cleanText(), extractData(), formatDate()

### Community 78 - "prepareSignature"
Cohesion: 0.83
Nodes (3): percentile(), prepareSignature(), toPng()

### Community 79 - "setup-claude-agent.sh"
Cohesion: 0.83
Nodes (3): say(), setup-claude-agent.sh script, usage()

### Community 80 - "App Favicon (favicon.svg)"
Cohesion: 1.00
Nodes (3): App Favicon (favicon.svg), Indigo #4f46e5 Brand Color, Shekel (₪) Brand Mark on Indigo Rounded Square

### Community 89 - "fixedAssets.ts"
Cohesion: 0.23
Nodes (16): assetYear, COLUMNS, createAsset(), dayIndex(), deleteAsset(), depreciationSchedule, FixedAsset, isoDate() (+8 more)

### Community 90 - "File Structure (new repo)"
Cohesion: 0.12
Nodes (16): File Structure (new repo), Task 11: Dropbox destination, Task 13: Gmail source, Task 14: Backfill and missed-by-label scan, Task 15: Worker loop, Task 16: UI API, Task 18: Web UI, Task 19: Packaging and docs (+8 more)

### Community 91 - "agentClient.ts"
Cohesion: 0.24
Nodes (11): agentCommand(), AgentRun, agentStatus(), hostVerifier(), ping(), privateKey(), runAgent(), agentConfig (+3 more)

### Community 92 - "db"
Cohesion: 0.29
Nodes (9): db, normalize(), rateFor(), AdjustmentsBreakdown, adjustmentsFor(), CategoryAdjustment, reconcile(), ReconciliationLine (+1 more)

### Community 93 - "Supported Israeli Banks and Credit Card Companies"
Cohesion: 0.22
Nodes (8): Authentication Notes, Banks, Credit Card Companies, Data Available, il-bank-mcp (Gilad Lekner), israeli-bank-mcp (Motti Bechhofer), MCP Server Coverage, Supported Israeli Banks and Credit Card Companies

### Community 94 - "getVatPercent"
Cohesion: 0.25
Nodes (11): getMorningSyncDays(), getVatPercent(), createWorksForDocument(), fillClientEmail(), mapStatus(), pullFromMorning(), resolveClient(), round2() (+3 more)

### Community 95 - "account-manager"
Cohesion: 0.33
Nodes (5): account-manager, Automation design, Setup, Structure, Usage

### Community 96 - "parseMetaAdsInvoice"
Cohesion: 0.60
Nodes (4): parseMetaAdsInvoice(), cleanText(), extractData(), formatDate()

### Community 97 - "Invoice Collector Implementation Plan"
Cohesion: 0.40
Nodes (4): Global Constraints, Invoice Collector Implementation Plan, Review Focus, Spec coverage check

### Community 99 - "invoice-collector v1 — decisions I made, and the go-live checklist"
Cohesion: 0.50
Nodes (3): Decisions I made without asking (each with its cost if wrong), Go-live checklist (Task 21, do together), invoice-collector v1 — decisions I made, and the go-live checklist

## Ambiguous Edges - Review These
- `extract_pdf.py` → `temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11)`  [AMBIGUOUS]
  .claude/skills/invoice-expert/temp_invoice.pdf · relation: shares_data_with
- `heichal-hatarbut.js` → `Ra'anana Municipality - Municipal Culture Hall (עיריית רעננה היכל התרבות העירוני)`  [AMBIGUOUS]
  havila/2026-01-to-2026-04/invoices-issued/2026-01-15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis.pdf · relation: conceptually_related_to
- `Tax Invoice-Receipt 60219 (type 320) — מופ"א — ₪13,855 (23/02/2026)` → `Israel Invoices Allocation Number (מספר הקצאה)`  [AMBIGUOUS]
  havila/2026-01-to-2026-04/invoices-issued/2026-02-23_type320_num60219_מופ"א_13855nis.pdf · relation: conceptually_related_to
- `עוסק מורשה Business Status` → `דוח שנתי מקוצר עוסק זעיר 2025 Template`  [AMBIGUOUS]
  graphify-out/converted/דוח_שנתי_עוסק_זעיר_2025_eea5449b.md · relation: conceptually_related_to

## Knowledge Gaps
- **588 isolated node(s):** `fs`, `parser`, `text`, `result`, `full` (+583 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 729 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `extract_pdf.py` and `temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `heichal-hatarbut.js` and `Ra'anana Municipality - Municipal Culture Hall (עיריית רעננה היכל התרבות העירוני)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Tax Invoice-Receipt 60219 (type 320) — מופ"א — ₪13,855 (23/02/2026)` and `Israel Invoices Allocation Number (מספר הקצאה)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `עוסק מורשה Business Status` and `דוח שנתי מקוצר עוסק זעיר 2025 Template`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `app lint & build job (npm ci -> lint -> test -> build on Node 22)` connect `Deploy workflow (production)` to `quoteMath.ts`, `package.json`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Clients()` connect `ui.tsx` to `nis`, `main`, `Button`, `api.ts`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `Job` connect `main` to `ui.tsx`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._