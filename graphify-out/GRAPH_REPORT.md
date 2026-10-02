# Graph Report - account-manager  (2026-10-02)

## Corpus Check
- 224 files · ~246,186 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 5, .csv 3, .example 2)

## Summary
- 1978 nodes · 5824 edges · 89 communities (79 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 199 edges (avg confidence: 0.87)
- Token cost: 740,225 input · 0 output

## Community Hubs (Navigation)
- Issued Invoices Jan–Apr 2026
- Auth & Quote Editor UI
- Moonlight Shows UI
- API Routes & MCP Tools
- Business Pages UI
- Quote Sharing & Email
- Fixed Assets & Tax Adjustments
- Charts & Reports Pages
- Annual Report & Money Formatting
- Invoice PDF Scripts & Thresholds
- Quote Lifecycle Server
- Quote Server Tests
- Invoice Intake Pipeline
- Supplier Auto-Assignment
- Moonlight Band Fund Backfill
- Payees Registry
- Morning Document Sync
- App Layout & Navigation
- Supplier Payments
- n8n + Agents Architecture
- Reconciliation & Payables Agents
- AI Agent Config & Secrets
- Meta Ads Campaign Analysis
- Public Quote Links
- VAT & Income Tax Reports
- Database Migrations & Settings
- Morning API Client
- AI Agent over SSH
- Settings & Calendar Rules Pages
- Bank Transaction Categorizer
- Deployment & AI Advisor Docs
- Login & Sessions
- Morning Expense Pull
- Annual Tax Assessment
- Google Calendar Sync
- App Features & Calendar Rules Docs
- Tax Estimates & Recognition Rates
- Server Entry & MCP Endpoint
- Tax Form Parser
- Quote Calendar Options
- Document Types
- Period Invoice Modal
- Credit Points (נקודות זיכוי)
- Runtime Dependencies
- Quote-to-Show Linking
- Bank Classification Rules
- Package Manifest
- Quotes Design Decisions
- Google Calendar Client
- Calendar Rule Engine
- TypeScript Config
- Quote Storage & Backups
- Meta Graph API Client
- Morning Issue Modal
- Tax Compliance Agent
- Expenses & Doc Types Docs
- Quote Routes
- Inbox Page
- Local Invoice Service
- CI/CD Pipeline
- Seed Data
- Carrefour Parsers
- Arnona Parser
- Moonlight Money Division
- Business Details
- Quote Math & Deposits
- Dev Dependencies
- npm Scripts
- External API & MCP Access
- Fuel Receipt Parsers
- MCP Desktop Bridge
- graphify Instructions
- 10ten Parser
- Vite Build Config
- Ginzburg Music Parser
- LivePlay Parser
- Morning Receipt Parser
- Tzmigei Shabtai Parser
- Signature Image Processing
- Agent Setup Script
- App Favicon
- Agent Shell Wrapper
- Backup Script
- Keepalive Script

## God Nodes (most connected - your core abstractions)
1. `nis()` - 83 edges
2. `get()` - 82 edges
3. `Button()` - 74 edges
4. `post()` - 63 edges
5. `getSetting()` - 55 edges
6. `react` - 51 edges
7. `Input()` - 51 edges
8. `uuid()` - 49 edges
9. `Empty()` - 49 edges
10. `Modal()` - 46 edges

## Surprising Connections (you probably didn't know these)
- `morning by Green Invoice (חשבונית ירוקה)` --conceptually_related_to--> `download_pdf()`  [INFERRED]
  havila/2026-01-to-2026-04/invoices-issued/2026-01-31_type300_num40222_אודי_קרני_3304nis.pdf → scripts/build_havila.py
- `Hebrew Theatre bank transfer ₪3,823 (27/02/2026) split across 60220 + 60221` --conceptually_related_to--> `bank-reconciler agent`  [INFERRED]
  havila/2026-01-to-2026-04/invoices-issued/2026-03-01_type320_num60220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis.pdf → .claude/agents/bank-reconciler.md
- `Tax Invoice 50095 (type 305) — נגיעה הפקות — ₪1,180 (14/04/2026)` --conceptually_related_to--> `receivables (גבייה) agent`  [INFERRED]
  havila/2026-01-to-2026-04/invoices-issued/2026-04-14_type305_num50095_נגיעה_הפקות_בע״מ_1180nis.pdf → .claude/agents/receivables.md
- `Israel Invoices Allocation Number (מספר הקצאה)` --conceptually_related_to--> `tax-compliance agent (virtual account manager)`  [INFERRED]
  havila/2026-01-to-2026-04/invoices-issued/2026-03-04_type320_num60222_זאפה_ניוקו_בע״מ_-_חיפה_26180nis.pdf → .claude/agents/tax-compliance.md
- `2026 expense summary by category (49 files, 84,638 NIS total, 77,215 NIS deductible)` --semantically_similar_to--> `Israeli tax expense category list (21 categories)`  [INFERRED] [semantically similar]
  expense-inventory-2026.md → .claude/skills/invoice-expert/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cowork agent bookkeeping loop over the Google Sheets data layer** — claude_agents_invoice_intake, claude_agents_bank_reconciler, claude_agents_payables, claude_agents_receivables, claude_agents_tax_compliance, readme_google_sheets_data_layer [INFERRED 0.85]
- **Vendor parser registry (vendor-mapping.json + per-vendor parsers)** — claude_skills_invoice_expert_vendor_parsers_vendor_mapping, claude_skills_invoice_expert_vendor_parsers_readme_parser_file_template, claude_skills_invoice_expert_vendor_parsers_morning, claude_skills_invoice_expert_vendor_parsers_arnona_hod_hasharon, claude_skills_invoice_expert_vendor_parsers_partner, claude_skills_invoice_expert_vendor_parsers_hot_mobile, claude_skills_invoice_expert_vendor_parsers_iec_hashmal, claude_skills_invoice_expert_vendor_parsers_delek_ocr, claude_skills_invoice_expert_vendor_parsers_10ten [EXTRACTED 1.00]
- **Human-in-the-loop: no autonomous financial actions** — claude_agents_bank_reconciler_read_only_bank_rule, claude_agents_payables_never_moves_money, claude_agents_receivables_gmail_draft_only, claude_skills_israeli_bank_connector_skill_no_payment_initiation, claude_agents_tax_compliance_advise_not_decide [INFERRED 0.85]
- **Deduction Ratio Encodings Across Sources** — app_readme_expense_recognition_rates, graphify_out_converted_דוח_שנתי_עוסק_זעיר_2025_eea5449b_expense_recognition_table, docs_data_schema_expenses_tab, docs_architecture_yearly_report_projection [INFERRED 0.75]
- **Freeze History Once Money or Consent Changes Hands** — docs_quotes_design_signed_snapshot, app_readme_settled_show_freeze, app_readme_campaign_figure_lock, app_readme_producer_fee, docs_quotes_design_quote_money [INFERRED 0.75]
- **Hardening of AI Agent Access (read-only, no side effects)** — app_readme_mcp_server, app_readme_agent_over_ssh, deploy_readme_agent_tool_hardening, deploy_readme_aiagent_forced_command, docs_architecture_security_rules [INFERRED 0.85]
- **Moonlight Coldplay tribute revenue documents, January 2026** — havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis_moonlight_coldplay_tribute_show, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60213_לאן_משרד_כרטיסים_בעמ_leanltd_13748nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_22_type300_num40218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_28_type320_num60216_עיריית_תל_אביב_יפו_16520nis [EXTRACTED 1.00]
- **HaTeatron HaIvri studio-hour show-prep projects** — havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_hateatron_haivri_association, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_studio_hour_sku, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis_schlager_gvarti_hanaava_computer_prep, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis_ofra_musical_computer_prep, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis_arik_einstein_project [EXTRACTED 1.00]
- **Billing lifecycle: transaction account (300) settled by tax invoice/receipt (320)** — havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis_doc_type_300_transaction_account, havila_2026_01_to_2026_04_invoices_issued_2026_01_08_type320_num60212_לאן_משרד_כרטיסים_בעמ_leanltd_2974nis_doc_type_320_tax_invoice_receipt, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_15_type320_num60215_התיאטרון_העברי_עמותה_לטיפוח_תר_1947nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_28_type320_num60216_עיריית_תל_אביב_יפו_16520nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_20_type300_num40217_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_22_type300_num40218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40219_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_01_29_type300_num40221_מירי_פרלמן_בע_מ_1770nis [INFERRED 0.85]
- **Deal→Receipt closings (300→320), Jan–Mar 2026** — havila_2026_01_to_2026_04_invoices_issued_deal_to_receipt_closing_pattern, havila_2026_01_to_2026_04_invoices_issued_doc_type_300_transaction_account, havila_2026_01_to_2026_04_invoices_issued_doc_type_320_tax_invoice_receipt, havila_2026_01_to_2026_04_invoices_issued_2026_01_31_type300_num40222_אודי_קרני_3304nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60217_אודי_קרני_6254nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_15_type300_num40223_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_23_type320_num60219_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60221_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_04_type320_num60222_זאפה_ניוקו_בע_מ_חיפה_26180nis [INFERRED 0.95]
- **Moonlight Coldplay-tribute revenue documents and gigs** — havila_2026_01_to_2026_04_invoices_issued_moonlight_coldplay_tribute, havila_2026_01_to_2026_04_invoices_issued_2026_02_04_type320_num60218_אן_אמ_סי_שקד_מועדונים_בעמ_2482nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_15_type300_num40223_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_02_23_type320_num60219_מופ_א_13855nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_04_type320_num60222_זאפה_ניוקו_בע_מ_חיפה_26180nis, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_music_city_2025_12_25, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_jems_petah_tikva, havila_2026_01_to_2026_04_invoices_issued_gig_moonlight_haifa_2026_01_07, havila_2026_01_to_2026_04_invoices_issued_vat_inclusive_gross_pricing [EXTRACTED 1.00]
- **Hebrew Theatre ₪3,823 split payment across two studio-hour receipts** — havila_2026_01_to_2026_04_invoices_issued_hebrew_theatre_split_transfer_3823, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60220_התיאטרון_העברי_עמותה_לטיפוח_תר_2549nis, havila_2026_01_to_2026_04_invoices_issued_2026_03_01_type320_num60221_התיאטרון_העברי_עמותה_לטיפוח_תר_1274nis, havila_2026_01_to_2026_04_invoices_issued_client_hebrew_theatre, havila_2026_01_to_2026_04_invoices_issued_studio_hour_rate_180, havila_2026_01_to_2026_04_invoices_issued_whole_shekel_rounding [EXTRACTED 1.00]

## Communities (89 total, 10 thin omitted)

### Community 0 - "Issued Invoices Jan–Apr 2026"
Cohesion: 0.07
Nodes (79): temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11), parseHeichalHatarbutInvoice(), cleanText(), extractData(), formatDate(), Tax Invoice/Receipt 60212 - LeanLTD - 2,974 NIS (2026-01-08), Doc type 320: Tax Invoice / Receipt (חשבונית מס / קבלה), Israeli VAT 18% (מע"מ) (+71 more)

### Community 1 - "Auth & Quote Editor UI"
Cohesion: 0.07
Nodes (67): get(), postFile(), AuthContext, AuthContextType, AuthProvider(), useAuth(), User, Login() (+59 more)

### Community 2 - "Moonlight Shows UI"
Cohesion: 0.10
Nodes (56): put(), AssetModal(), isTab(), MembersPanel(), Moonlight(), MOVED, BUSINESS_TYPES, BusinessType (+48 more)

### Community 3 - "API Routes & MCP Tools"
Cohesion: 0.07
Nodes (45): annualReport, assignmentsForEvent(), deleteSupplier, missingRoles(), createRule(), getRule(), normalizeAmount(), updateRule() (+37 more)

### Community 4 - "Business Pages UI"
Cohesion: 0.12
Nodes (50): api(), del(), post(), Clients(), emptyForm, initials(), Expenses(), Invoices() (+42 more)

### Community 5 - "Quote Sharing & Email"
Cohesion: 0.08
Nodes (49): CARD, DEFAULT_MESSAGE, DEFAULT_SUBJECT, fillMessage(), gmailUrl(), mailtoUrl(), MESSAGE_PLACEHOLDERS, MessageFields (+41 more)

### Community 6 - "Fixed Assets & Tax Adjustments"
Cohesion: 0.07
Nodes (52): assetYear, COLUMNS, createAsset(), dayIndex(), deleteAsset(), depreciationSchedule, FixedAsset, isoDate() (+44 more)

### Community 7 - "Charts & Reports Pages"
Cohesion: 0.08
Nodes (45): dayShort(), monthLabel(), monthName(), monthSlash(), plain(), SHORT_MONTHS, signedPercent(), Basis (+37 more)

### Community 8 - "Annual Report & Money Formatting"
Cohesion: 0.10
Nodes (44): nis(), nisExact(), shekels(), PerShowChart(), AnnualReport(), CertificateUpload(), FIELD_GROUPS, FIELD_LABELS (+36 more)

### Community 9 - "Invoice PDF Scripts & Thresholds"
Cohesion: 0.06
Nodes (16): Green Invoice expense payload, Threshold watch (500K NIS turnover -> 874 VAT report; מספר הקצאה above 10K NIS, 5K NIS from June 2026), parseMetaAdsInvoice(), cleanText(), extractData(), formatDate(), account-manager README, Green Invoice (Morning) invoicing platform and API (+8 more)

### Community 10 - "Quote Lifecycle Server"
Cohesion: 0.10
Nodes (46): addDays(), BuiltinKey, cancelQuote(), clampDays(), cleanContent(), cleanLines(), cleanPackage(), color() (+38 more)

### Community 11 - "Quote Server Tests"
Cohesion: 0.06
Nodes (16): events, fake, MEMBERS, requests, jpeg, png, webp, META (+8 more)

### Community 12 - "Invoice Intake Pipeline"
Cohesion: 0.09
Nodes (32): invoice-intake agent, Expenses sheet, n8n integration guide (Invoice Expert), Option 1: Claude API via n8n HTTP Request (recommended), Option 2: Claude Code CLI via n8n Execute Command, Invoice extraction system prompt (Hebrew JSON fields), JSON extraction from Claude output (markdown-fence fallback), Vision input for PDFs and scanned images (base64 media types) (+24 more)

### Community 13 - "Supplier Auto-Assignment"
Cohesion: 0.11
Nodes (38): applyDefaultAmount(), ASSIGNMENT_ROLES(), attendeeEmails(), autoAssignAll, autoAssignEvent(), defaultAmount(), listSuppliers(), normalizeEmail() (+30 more)

### Community 14 - "Moonlight Band Fund Backfill"
Cohesion: 0.09
Nodes (38): setOverride(), bandEventIsEmpty(), adjustBandFundActual(), ALWAYS_SETTLED, backfillEventShares(), backfillFundTransfers(), backfillMoonlight(), bandMemberByKey() (+30 more)

### Community 15 - "Payees Registry"
Cohesion: 0.14
Nodes (35): keyOf(), listPayees(), memberPayee(), Payee, payeeColumns(), payeeKey(), payeeRef(), payeesByKey() (+27 more)

### Community 16 - "Morning Document Sync"
Cohesion: 0.12
Nodes (33): BusinessDetails, createDocument(), documentUrl(), MorningError, buildMorningDraft(), buildPendingMorningDraft(), ClientRow, createWorksForDocument() (+25 more)

### Community 17 - "App Layout & Navigation"
Cohesion: 0.10
Nodes (31): bizMobile, bizNav(), initials(), Layout(), Logo(), moonMobile, moonNav, NavGroup (+23 more)

### Community 18 - "Supplier Payments"
Cohesion: 0.14
Nodes (32): PayeeKind, AssignmentRole, availableOf(), deletePayment, documentedTotal(), getPayment(), hasDocs(), isCertain() (+24 more)

### Community 19 - "n8n + Agents Architecture"
Cohesion: 0.16
Nodes (27): bank-monitor Agent, Four-Week Automation Build Order, Business Automation Architecture (n8n + Sheets + Cowork), Dropbox Canonical Filing Convention, invoice-intake Agent, Morning / Green Invoice Accounting System, payables Agent, receivables Agent (+19 more)

### Community 20 - "Reconciliation & Payables Agents"
Cohesion: 0.13
Nodes (24): bank-reconciler agent, Clients sheet, Credit-to-invoice matching (exact / probable / unmatched), Deadlines sheet, Debit matching to payables and tax deadlines (verified_paid), Invoices_Issued sheet, Paid invoice with no קבלה (receipt) issued in Morning, Payables sheet (+16 more)

### Community 21 - "AI Agent Config & Secrets"
Cohesion: 0.14
Nodes (26): agentStatus(), agentConfig, AgentConfigError, AgentConfigPatch, agentConfigView(), DEFAULT_COMMAND, DEFAULT_PORT, DEFAULT_TIMEOUT_MS (+18 more)

### Community 22 - "Meta Ads Campaign Analysis"
Cohesion: 0.17
Nodes (28): AdviserContext, buildContext(), getMetaCurrencyRate(), getMetaSyncDays(), isMetaConfigured(), adAnalysis(), AdAnalysisRow, applyCampaignSpend() (+20 more)

### Community 23 - "Public Quote Links"
Cohesion: 0.15
Nodes (27): bandSignatureDataUrl(), CLIENT_FIELDS, documentOf(), EmailCard, fileId(), liveBranding(), newToken(), PublicBranding (+19 more)

### Community 24 - "VAT & Income Tax Reports"
Cohesion: 0.13
Nodes (27): bracketTax(), dueDate(), emptyRow(), ExpenseBasis, expenseDateSql(), getVatFrequency(), HEB_MONTHS, incomeTaxReport (+19 more)

### Community 25 - "Database Migrations & Settings"
Cohesion: 0.13
Nodes (20): correctSwappedLocalDocTypes(), __dirname, getSetting(), getVatPercent(), seedDefaultCalendarRules(), setSetting(), brandingImage(), BrandingKind (+12 more)

### Community 26 - "Morning API Client"
Cohesion: 0.11
Nodes (24): audit, full, total, CreateDocumentInput, DocumentPayment, getDocument(), getExpense(), getToken() (+16 more)

### Community 27 - "AI Agent over SSH"
Cohesion: 0.16
Nodes (22): agentCommand(), AgentError, AgentRun, hostVerifier(), ping(), privateKey(), runAgent(), isAgentConfigured() (+14 more)

### Community 28 - "Settings & Calendar Rules Pages"
Cohesion: 0.12
Nodes (22): AgentSettings(), AgentView, FromEnv(), AmountField(), CalendarOption, CalendarRules(), ClientField(), Override (+14 more)

### Community 29 - "Bank Transaction Categorizer"
Cohesion: 0.11
Nodes (11): deduct_pct business-use ratios (car 45%, home-office utilities 15%, phone/internet 80%, direct business 100%), Missing musician/subcontractor invoice detection (קבלנות משנה - נגנים), analyze_transactions(), categorize_transaction(), format_analysis(), generate_example_transactions(), main(), 2026 expense summary by category (49 files, 84,638 NIS total, 77,215 NIS deductible) (+3 more)

### Community 30 - "Deployment & AI Advisor Docs"
Cohesion: 0.11
Nodes (19): Heebo Font (Google Fonts), index.html SPA Entry (Hebrew RTL), Settings → סוכן AI (AGENT_SSH_* fallback), יועץ קמפיינים AI Campaign Advisor, CI Workflow (tsc lint, vite build, node tests), SSH Host Key Pinning, SQLite Database (account-manager.db, better-sqlite3), React 19 + Vite + Express + SQLite Stack (+11 more)

### Community 31 - "Login & Sessions"
Cohesion: 0.12
Nodes (21): clearLoginAttempts(), clientIp(), createSession(), currentSessionToken(), destroySession(), Express, loadUser(), login() (+13 more)

### Community 32 - "Morning Expense Pull"
Cohesion: 0.14
Nodes (23): getMorningSyncDays(), expenseClassifications(), isMorningConfigured(), category(), docType(), expenseCategories(), ExpenseFilters, ExpenseMoney (+15 more)

### Community 33 - "Annual Tax Assessment"
Cohesion: 0.17
Nodes (22): AllowedFigure, annualAssessment, AnnualBasis, AnnualDeadline, annualOutlook, defaultFileBy(), emptyProfile(), getProfile() (+14 more)

### Community 34 - "Google Calendar Sync"
Cohesion: 0.19
Nodes (22): eventDate(), listEvents(), overrideMap(), applyBandEvent(), applyCancellation(), applyPersonalWork(), CalendarSyncResult, fetchCalendars() (+14 more)

### Community 35 - "App Features & Calendar Rules Docs"
Cohesion: 0.13
Nodes (17): Account Manager Web App, Calendar Manual Overrides (exclude / include), Calendar Rule Preview (dry run), Google Calendar Sync Rules, Morning (Green Invoice) Integration, Morning Pull Sync (/integrations/morning/sync), Morning Push (createDocument / issue-to-morning), Moonlight Price Quotes (הצעות מחיר) (+9 more)

### Community 36 - "Tax Estimates & Recognition Rates"
Cohesion: 0.15
Nodes (21): סקירה Dashboard Overview (overview.ts), Expense Recognition Rates (expense_recognition_rates), מס הכנסה Income Tax Estimate, Period Filter (dateRange), דוחות Reports Page, TAX_RATES (server/reports.ts), מקדמות מס Advance-Tax Check, עוסק מורשה Business Status (+13 more)

### Community 37 - "Server Entry & MCP Endpoint"
Cohesion: 0.11
Nodes (18): app, __dirname, fail(), handleRpc(), JsonRpcRequest, JsonRpcResponse, mcpHttpHandler(), ok() (+10 more)

### Community 38 - "Tax Form Parser"
Cohesion: 0.12
Nodes (19): AnnualProfile, CODES, codesIn(), CodeSpec, detectKind(), detectYear(), extractLines(), FormKind (+11 more)

### Community 39 - "Quote Calendar Options"
Cohesion: 0.21
Nodes (20): getEventById(), isCalendarConfigured(), listRules(), calendarStatus(), afterWrite(), bandRule(), calendarDraft(), CalendarForm (+12 more)

### Community 40 - "Document Types"
Cohesion: 0.11
Nodes (20): ACCOUNTING_DOC_TYPES, ACCOUNTING_DOC_TYPES_SQL, CREDIT_DOC_TYPES, ISSUABLE_DOC_TYPES, issuableDocTypeOptions(), PAYMENT_DOC_TYPES, PAYMENT_TYPE, PAYMENT_TYPE_LABELS (+12 more)

### Community 41 - "Period Invoice Modal"
Cohesion: 0.13
Nodes (19): heDate(), monthEnd(), MonthPick(), MONTHS, monthStart(), PeriodInvoiceModal(), WorkList(), badgeLabels (+11 more)

### Community 42 - "Credit Points (נקודות זיכוי)"
Cohesion: 0.16
Nodes (17): childPoints(), clearCreditStatus(), creditBreakdown, CreditChild, CreditLine, CreditStatus, dischargePoints(), EMPTY_STATUS (+9 more)

### Community 43 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, clsx, date-fns, dotenv, express, lucide-react, pdfjs-dist, react (+11 more)

### Community 44 - "Quote-to-Show Linking"
Cohesion: 0.20
Nodes (18): getEvent(), afterSigning(), amountsDisagree(), claimedByAnother(), fillAmounts(), linkQuoteToShow(), linkSignedQuote(), markSignedSeen() (+10 more)

### Community 45 - "Bank Classification Rules"
Cohesion: 0.21
Nodes (14): Bank transaction classification (client_payment / supplier_payment / tax_vat / tax_bituach_leumi / tax_income / bank_fee / personal / other), Israeli spending categories reference, Supported Israeli banks and credit-card companies reference, CompanyTypes enum coverage (14 banks + 4 card companies, israeli-bank-scrapers >= 6.7.x), MCP server coverage notes, Bank scraper authentication (2FA/OTP, ~15-30 min sessions, rate limits), israeli-bank-connector skill, Bank of Israel identification codes (2 -> 3 digits by end of 2026) (+6 more)

### Community 46 - "Package Manifest"
Cohesion: 0.11
Nodes (17): name, private, type, version, better-sqlite3, date-fns, react-dom, tailwind-merge (+9 more)

### Community 47 - "Quotes Design Decisions"
Cohesion: 0.16
Nodes (16): מה דורש טיפול Inbox (/api/inbox), Cloudflare Access with Bypass Paths, Quote vs Show Amount Disagreement, Deposit Percent ({deposit}), Quote Follow-ups (quoteFollowUps), Moonlight Quotes Design, Public Quote API (/api/public/quotes, token), Public Quote Page (/q/:token) (+8 more)

### Community 48 - "Google Calendar Client"
Cohesion: 0.22
Nodes (16): CalendarAttendee, CalendarError, CalendarEvent, CalendarSummary, EventInput, getAccessToken(), insertEvent(), listCalendars() (+8 more)

### Community 49 - "Calendar Rule Engine"
Cohesion: 0.17
Nodes (17): CalendarRule, cleanTitle(), deleteOverride(), deleteRule(), escapeRegExp(), evaluate(), EventOverride, haystack() (+9 more)

### Community 50 - "TypeScript Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution (+7 more)

### Community 51 - "Quote Storage & Backups"
Cohesion: 0.15
Nodes (13): Secret Encryption (AES-256-GCM, secret.key), am-data Volume, SQLite Online Backup to Cloudflare R2, band_quote_files Table (BLOBs), band_quote_items Table, band_quote_packages Table, band_quotes Table, Quote Branding (logo, colours, signature) (+5 more)

### Community 52 - "Meta Graph API Client"
Cohesion: 0.23
Nodes (13): accessToken(), adAccountId(), fetchAccount(), fetchCampaigns(), fetchDailyCampaignInsights(), graph(), graphPaged(), MetaAccount (+5 more)

### Community 53 - "Morning Issue Modal"
Cohesion: 0.25
Nodes (14): Business, computeDueDate(), docDate(), DocumentPreview(), Draft, DraftLine, Form, he() (+6 more)

### Community 54 - "Tax Compliance Agent"
Cohesion: 0.20
Nodes (13): Dropbox filing path (חשבוניות - קבלות/<year>/<category>/<finalName>), tax-compliance agent (virtual account manager), Annual report outlook (balance, shortfall, payments, mikdamot_paid, deadline, configured), get_annual_report MCP tool (דוח שנתי), get_tax_report MCP tool (מע"מ periods), list_invoices / list_expenses MCP tools, מקדמות מס (income-tax advances) check, Yearly_Report sheet (+5 more)

### Community 55 - "Expenses & Doc Types Docs"
Cohesion: 0.16
Nodes (12): פרטי העסק Business Details Letterhead, Revenue Document Types (docTypes.ts: 305, 320), Expense Status Audit & expenses:probe, הוצאות Expenses Page (read-only Morning mirror), expenses.raw Payload Retention, monthlyPnl Shared P&L Query (ExpenseBasis), Morning Expenses Sync (expenses-sync), Two-Step Morning Issue Dialog (morning-draft) (+4 more)

### Community 56 - "Quote Routes"
Cohesion: 0.17
Nodes (7): requireOwner(), ownerForSignature(), quoteRouter, deletePackage(), EVENT_TYPES, listPackages(), listTemplates()

### Community 57 - "Inbox Page"
Cohesion: 0.23
Nodes (10): Figure(), Inbox(), Item, ItemCard(), Kind, TABS, TONES, InkPanel() (+2 more)

### Community 58 - "Local Invoice Service"
Cohesion: 0.24
Nodes (11): DOC_TYPE, createInvoice(), CreateInvoiceInput, deleteInvoice(), getInvoice(), LineItemInput, LOCAL_NUMBER_PREFIX, nextInvoiceNumber() (+3 more)

### Community 59 - "CI/CD Pipeline"
Cohesion: 0.29
Nodes (11): better-sqlite3, deploy/Dockerfile (Node 22 app image), CI workflow (lint & build), app lint & build job (npm ci -> lint -> test -> build on Node 22), Deploy workflow (production), Container HEALTHCHECK readiness wait, Production environment (im-tools.org), Deploy secrets (DEPLOY_HOST, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, DEPLOY_USER) (+3 more)

### Community 60 - "Seed Data"
Cohesion: 0.29
Nodes (9): hashPassword(), DOC_TYPE_LABELS, MOONLIGHT_EVENT_EXPENSES, MOONLIGHT_GENERAL_EXPENSES, MOONLIGHT_INCOME, __dirname, parseCsv(), runSeed() (+1 more)

### Community 61 - "Carrefour Parsers"
Cohesion: 0.22
Nodes (7): Carrefour - Global Retail K.Y. (M.D.) Ltd, Hod HaSharon branch (vendor), parseCarrefourGlobalInvoice(), extractData(), formatDate(), parseCarrefourInvoice(), extractData(), formatDate()

### Community 63 - "Moonlight Money Division"
Cohesion: 0.22
Nodes (7): Campaign → Show Mapping (weights, suggestions), Meta Ads Sync, Monthly Meta Invoice vs Per-Show Ad Cost Partitions, Moonlight Member Division (three steps), venue_locked / description_locked Name Locks, Producer Fee (computeDivision, commission_percent), Signed Snapshot (SHA-256 frozen)

### Community 64 - "Business Details"
Cohesion: 0.36
Nodes (7): BUSINESS_TYPE_LABELS, BusinessInput, Field, FIELDS, getBusinessDetails(), setBusinessDetails(), settingKey()

### Community 65 - "Quote Math & Deposits"
Cohesion: 0.43
Nodes (7): amount(), computeTotals(), DEPOSIT_PLACEHOLDER, depositAmount(), QuoteLine, QuoteLineInput, round2()

### Community 66 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/better-sqlite3, @types/express, @types/node, @types/react, @types/react-dom, typescript

### Community 67 - "npm Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, expenses:probe, lint, start, test

### Community 68 - "External API & MCP Access"
Cohesion: 0.29
Nodes (5): X-API-Key Authentication, External API (/api/v1), mcp-bridge.mjs Claude Desktop Relay, MCP Server (/mcp) Read-only Access, MCP Tool List (mcpTools.ts)

### Community 69 - "Fuel Receipt Parsers"
Cohesion: 0.29
Nodes (3): temp-invoice-text.txt (Weezmo fuel receipt OCR sample), Weezmo digital fuel receipt (ENI Mobile / מנטה קמעונאות, 23/01/25, 245.19 NIS), parseDelekOCRInvoice()

### Community 70 - "MCP Desktop Bridge"
Cohesion: 0.53
Nodes (4): forward(), send(), sendError(), TIMEOUT_MS

### Community 71 - "graphify Instructions"
Cohesion: 0.47
Nodes (4): CLAUDE.md (graphify usage rules), .claude/CLAUDE.md (graphify skill trigger), /graphify slash-command trigger, graphify knowledge graph (graphify-out/)

### Community 73 - "Vite Build Config"
Cohesion: 0.40
Nodes (4): start(), @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 74 - "Ginzburg Music Parser"
Cohesion: 0.50
Nodes (3): parseGinzburgMusicInvoice(), cleanText(), extractData()

### Community 75 - "LivePlay Parser"
Cohesion: 0.50
Nodes (3): parseLivePlayInvoice(), extractData(), formatDate()

### Community 76 - "Morning Receipt Parser"
Cohesion: 0.60
Nodes (4): parseMorningInvoice(), cleanText(), extractData(), formatDate()

### Community 77 - "Tzmigei Shabtai Parser"
Cohesion: 0.60
Nodes (4): parseTzmigeiShabtaiInvoice(), cleanText(), extractData(), formatDate()

### Community 78 - "Signature Image Processing"
Cohesion: 0.83
Nodes (3): percentile(), prepareSignature(), toPng()

### Community 79 - "Agent Setup Script"
Cohesion: 0.83
Nodes (3): say(), setup-claude-agent.sh script, usage()

### Community 80 - "App Favicon"
Cohesion: 1.00
Nodes (3): App Favicon (favicon.svg), Indigo #4f46e5 Brand Color, Shekel (₪) Brand Mark on Indigo Rounded Square

## Ambiguous Edges - Review These
- `extract_pdf.py` → `temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11)`  [AMBIGUOUS]
  .claude/skills/invoice-expert/temp_invoice.pdf · relation: shares_data_with
- `heichal-hatarbut.js` → `Ra'anana Municipality - Municipal Culture Hall (עיריית רעננה היכל התרבות העירוני)`  [AMBIGUOUS]
  havila/2026-01-to-2026-04/invoices-issued/2026-01-15_type320_num60214_עיריית_רעננה_היכל_התרבות_העירו_3074nis.pdf · relation: conceptually_related_to
- `meta-ads.js` → `Meta Ads ad-spend sync (web app)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `Israeli tax expense category list (21 categories)` → `vendor-mapping.json`  [AMBIGUOUS]
  .claude/skills/invoice-expert/vendor-parsers/README.md · relation: conceptually_related_to
- `עוסק מורשה Business Status` → `דוח שנתי מקוצר עוסק זעיר 2025 Template`  [AMBIGUOUS]
  graphify-out/converted/דוח_שנתי_עוסק_זעיר_2025_eea5449b.md · relation: conceptually_related_to
- `Tax Invoice-Receipt 60219 (type 320) — מופ"א — ₪13,855 (23/02/2026)` → `Israel Invoices Allocation Number (מספר הקצאה)`  [AMBIGUOUS]
  havila/2026-01-to-2026-04/invoices-issued/2026-02-23_type320_num60219_מופ"א_13855nis.pdf · relation: conceptually_related_to

## Knowledge Gaps
- **364 isolated node(s):** `fs`, `parser`, `text`, `result`, `full` (+359 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 478 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `extract_pdf.py` and `temp_invoice.pdf - Carrefour (Global Retail) receipt, 59.50 NIS (2025-12-11)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `heichal-hatarbut.js` and `Ra'anana Municipality - Municipal Culture Hall (עיריית רעננה היכל התרבות העירוני)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `meta-ads.js` and `Meta Ads ad-spend sync (web app)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Israeli tax expense category list (21 categories)` and `vendor-mapping.json`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `עוסק מורשה Business Status` and `דוח שנתי מקוצר עוסק זעיר 2025 Template`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Tax Invoice-Receipt 60219 (type 320) — מופ"א — ₪13,855 (23/02/2026)` and `Israel Invoices Allocation Number (מספר הקצאה)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `get_annual_report MCP tool (דוח שנתי)` connect `Tax Compliance Agent` to `Annual Tax Assessment`, `API Routes & MCP Tools`, `Reconciliation & Payables Agents`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._