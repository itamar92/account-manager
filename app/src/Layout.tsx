import React from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Inbox, LayoutDashboard, Users, Briefcase, FileText, Receipt, FileBarChart, Settings,
  LogOut, Wallet, Music, Megaphone, Sparkles, CalendarCheck, Plus, ChevronDown, MoreHorizontal,
  Calculator, HandCoins, Tags,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from './AuthContext';
import { get } from './api';
import { MoneyCalculator } from './pages/moonlight/MoneyCalculator';

type NavItem = { to: string; label: string; icon: React.ElementType; badge?: number };
type NavGroup = { head?: string; items: NavItem[] };

/**
 * Two workspaces, one app. The business side and the band's side keep separate navigation and
 * separate accent colours, because they are separate books — mixing a gig's supplier debt into
 * the same list as a client invoice has never once been the question anybody was asking.
 */
const bizNav = (inboxBadge?: number): NavGroup[] => [
  {
    items: [
      { to: '/', label: 'מה דורש טיפול', icon: Inbox, badge: inboxBadge },
      { to: '/overview', label: 'סקירה', icon: LayoutDashboard },
    ],
  },
  {
    head: 'כסף',
    items: [
      { to: '/works', label: 'עבודות', icon: Briefcase },
      { to: '/invoices', label: 'חשבוניות', icon: FileText },
      { to: '/expenses', label: 'הוצאות', icon: Receipt },
      { to: '/reports', label: 'דוחות וסגירת חודש', icon: FileBarChart },
    ],
  },
  {
    head: 'ניהול',
    items: [
      { to: '/clients', label: 'לקוחות', icon: Users },
      { to: '/settings', label: 'הגדרות', icon: Settings },
    ],
  },
];

const moonNav: NavGroup[] = [
  {
    items: [
      { to: '/moonlight/summary', label: 'סקירה כספית', icon: Wallet },
      // A show's income, costs and staffing live on the show itself, so this one entry is
      // the way into all three.
      { to: '/moonlight/shows', label: 'הופעות', icon: Music },
    ],
  },
  {
    head: 'כסף',
    items: [
      { to: '/moonlight/suppliers', label: 'ספקים וחברים', icon: Users },
      // What went out to the suppliers, and which of it still owes the books a document.
      { to: '/moonlight/supplierPayments', label: 'תשלומים לספקים', icon: HandCoins },
      // What each supplier is called on the invoices they send, which is what lets the two
      // entries above it recognise a document without being asked every time.
      { to: '/moonlight/supplierNames', label: 'שמות בחשבוניות', icon: Tags },
      { to: '/moonlight/generalExpenses', label: 'הוצאות כלליות', icon: Receipt },
    ],
  },
  {
    head: 'פרסום',
    items: [
      { to: '/moonlight/ads', label: 'קמפיינים', icon: Megaphone },
      { to: '/moonlight/campaignAi', label: 'יועץ קמפיינים', icon: Sparkles },
    ],
  },
];

/** The handful of destinations reachable from anywhere, in the order they are needed most. */
const quickActions = [
  { to: '/works?new=1', label: 'עבודה חדשה' },
  { to: '/invoices', label: 'חשבונית מעבודות' },
  { to: '/clients?new=1', label: 'לקוח חדש' },
  { to: '/moonlight/shows?new=1', label: 'הופעה חדשה' },
];

/**
 * The phone's bottom bar: the four destinations worth a thumb. Everything else the workspace
 * has is one tap away under «עוד», which lists the sidebar in full — a screen with no bar slot
 * used to be unreachable on a phone altogether.
 */
const bizMobile: NavItem[] = [
  { to: '/', label: 'טיפול', icon: Inbox },
  { to: '/works', label: 'עבודות', icon: Briefcase },
  { to: '/invoices', label: 'חשבוניות', icon: FileText },
  { to: '/expenses', label: 'הוצאות', icon: Receipt },
];

const moonMobile: NavItem[] = [
  { to: '/moonlight/summary', label: 'סקירה', icon: Wallet },
  { to: '/moonlight/shows', label: 'הופעות', icon: Music },
  { to: '/moonlight/suppliers', label: 'ספקים', icon: Users },
  { to: '/moonlight/ads', label: 'פרסום', icon: Megaphone },
];

/** Two Hebrew letters is what fits an avatar and still says who is signed in. */
const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?';

export function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inboxCount, setInboxCount] = React.useState<number | undefined>();
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [calcOpen, setCalcOpen] = React.useState(false);

  const moon = location.pathname.startsWith('/moonlight');

  // The sheet is a way through to somewhere, so arriving there closes it.
  React.useEffect(() => setMoreOpen(false), [location.pathname]);

  // The accent, the canvas and the borders all hang off this one attribute (see index.css),
  // so switching workspaces recolours the whole app without a single component knowing.
  React.useEffect(() => {
    document.documentElement.dataset.ws = moon ? 'moon' : 'biz';
  }, [moon]);

  // The badge is the same count the inbox page shows; it is fetched once per session because
  // it changes only when something on that page is dealt with.
  React.useEffect(() => {
    if (user?.role !== 'owner') return;
    get('/inbox').then((d) => setInboxCount(d.inbox.openCount)).catch(() => {});
  }, [user?.role, location.pathname]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-faint">טוען…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const isOwner = user.role === 'owner';
  // Band members are locked to the Moonlight area — personal accounting routes are owner-only.
  if (!isOwner && !moon) return <Navigate to="/moonlight/summary" replace />;

  const groups = moon ? moonNav : bizNav(inboxCount);
  const mobileItems = moon ? moonMobile : bizMobile;

  const navClass = (isActive: boolean) =>
    clsx(
      'flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[15px] transition-colors',
      isActive
        ? 'bg-accent-soft text-accent-ink font-semibold'
        : 'text-ink-2 hover:bg-soft'
    );

  const wsChip = (active: boolean) =>
    clsx(
      'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors',
      active ? 'bg-accent text-white' : 'text-muted hover:text-ink-2'
    );

  return (
    <div className="min-h-screen flex flex-col">
      {/* ---- header ---- */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-5 px-4 md:px-5 py-2.5 bg-surface border-b border-line">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <Logo />
            <span className="ser text-[15px] md:text-base">Account&nbsp;Manager</span>
          </div>
          {isOwner && (
            <div className="hidden sm:flex gap-0.5 p-0.5 bg-soft border border-line rounded-full">
              <button className={wsChip(!moon)} onClick={() => navigate('/')}>עסק</button>
              <button className={wsChip(moon)} onClick={() => navigate('/moonlight/summary')}>Moonlight</button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-2.5">
          {isOwner && (
            <div className="relative hidden md:block">
              <button
                onClick={() => setQuickOpen((v) => !v)}
                onBlur={() => setTimeout(() => setQuickOpen(false), 150)}
                className="flex items-center gap-2 bg-accent text-white rounded-[10px] px-3.5 py-2 text-sm font-semibold"
              >
                <Plus size={16} /> פעולה מהירה <ChevronDown size={14} />
              </button>
              {quickOpen && (
                <div className="absolute end-0 mt-1.5 w-48 bg-surface border border-line rounded-xl shadow-[0_12px_30px_rgba(20,24,32,.15)] overflow-hidden">
                  {quickActions.map((a) => (
                    <button
                      key={a.to}
                      onMouseDown={(e) => { e.preventDefault(); setQuickOpen(false); navigate(a.to); }}
                      className="block w-full text-start px-3.5 py-2.5 text-sm text-ink-2 hover:bg-soft"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Moonlight's pocket calculator. It floats over the page rather than replacing it,
              because both sums it does are read against numbers already on screen. */}
          {moon && isOwner && (
            <button
              onClick={() => setCalcOpen((v) => !v)}
              title='מחשבון מע"מ והעברות'
              className={clsx(
                'p-2 rounded-lg transition-colors',
                calcOpen ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:text-ink-2 hover:bg-soft'
              )}
            >
              <Calculator size={18} />
            </button>
          )}
          <div
            title={`${user.name} · ${isOwner ? 'בעלים' : 'חבר להקה'}`}
            className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center text-sm font-semibold shrink-0"
          >
            {initials(user.name)}
          </div>
          <button
            onClick={logout}
            title="התנתקות"
            className="p-2 rounded-lg text-faint hover:text-neg hover:bg-soft transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* the workspace switch, where the header has no room for it */}
      {isOwner && (
        <div className="sm:hidden flex gap-0.5 p-0.5 mx-4 mt-3 bg-soft border border-line rounded-full">
          <button className={clsx(wsChip(!moon), 'flex-1')} onClick={() => navigate('/')}>עסק</button>
          <button className={clsx(wsChip(moon), 'flex-1')} onClick={() => navigate('/moonlight/summary')}>Moonlight</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* ---- sidebar ---- */}
        {/* The surface is on the outer column so it runs the whole page however long the
            content gets; the nav inside it is what sticks to the top when you scroll. */}
        <div className="hidden md:block w-60 shrink-0 border-s border-line bg-surface">
          <nav className="p-3 sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto">
            <NavGroups groups={groups} navClass={navClass} />
          </nav>
        </div>

        {/* ---- content ---- */}
        <main className="flex-1 min-w-0 p-4 md:p-7 pb-24 md:pb-10">
          <div className="max-w-[1200px] mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ---- phone nav ---- */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-line flex justify-around px-1 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {mobileItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg shrink-0',
                isActive ? 'text-accent' : 'text-faint'
              )
            }
          >
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={clsx(
            'flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg shrink-0',
            moreOpen ? 'text-accent' : 'text-faint'
          )}
        >
          <MoreHorizontal size={20} /> עוד
        </button>
      </nav>

      {/* The rest of the workspace, on a phone: the whole sidebar as a sheet. */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-[rgba(26,22,45,.45)] flex items-end"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="w-full bg-surface rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="ser text-lg">{moon ? 'Moonlight' : 'העסק'} · כל המסכים</h2>
              <button
                onClick={() => setMoreOpen(false)}
                className="bg-soft rounded-lg w-8 h-8 text-ink-2 leading-none shrink-0"
              >
                ✕
              </button>
            </div>
            <NavGroups groups={groups} navClass={navClass} />
          </div>
        </div>
      )}

      {moon && isOwner && <MoneyCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />}
    </div>
  );
}

/** The workspace's destinations, drawn the same for the sidebar and for the phone's sheet. */
function NavGroups({ groups, navClass }: {
  groups: NavGroup[];
  navClass: (isActive: boolean) => string;
}) {
  return (
    <>
      {groups.map((group, i) => (
        <div key={group.head ?? i} className="mb-4 last:mb-0">
          {group.head && (
            <div className="text-[11px] font-semibold tracking-[.1em] text-ghost px-3 pb-1.5">
              {group.head}
            </div>
          )}
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon, badge }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => navClass(isActive)}>
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{label}</span>
                {!!badge && (
                  <span className="num ms-auto bg-neg text-white text-xs px-1.5 rounded-full">{badge}</span>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** The bar-chart mark from the app icon, drawn inline so it takes the workspace accent. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" aria-hidden>
      <g stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" className="text-ink">
        <path d="M6 16v0" /><path d="M11 13v6" /><path d="M16 10v12" /><path d="M21 12.5v7" /><path d="M26 16v0" />
      </g>
      <rect x="6" y="25" width="20" height="3.2" rx="1.6" className="fill-accent" />
    </svg>
  );
}
