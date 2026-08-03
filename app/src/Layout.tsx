import React from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Briefcase, FileText, Receipt, FileBarChart, Moon, Settings, LogOut } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from './AuthContext';

const ownerNav = [
  { to: '/', label: 'דשבורד', icon: LayoutDashboard },
  { to: '/works', label: 'עבודות', icon: Briefcase },
  { to: '/invoices', label: 'חשבוניות', icon: FileText },
  { to: '/expenses', label: 'הוצאות', icon: Receipt },
  { to: '/reports', label: 'דוחות', icon: FileBarChart },
  { to: '/clients', label: 'לקוחות', icon: Users },
  { to: '/moonlight', label: 'Moonlight', icon: Moon },
  { to: '/settings', label: 'הגדרות', icon: Settings },
];

const bandNav = [{ to: '/moonlight', label: 'Moonlight', icon: Moon }];

export function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">טוען…</div>;
  if (!user) return <Navigate to="/login" replace />;

  // Band members are locked to the Moonlight area — personal accounting routes are owner-only.
  if (user.role === 'band' && !location.pathname.startsWith('/moonlight')) {
    return <Navigate to="/moonlight" replace />;
  }

  const nav = user.role === 'owner' ? ownerNav : bandNav;

  const linkClass = (isActive: boolean, mobile = false) =>
    clsx(
      'flex items-center gap-3 rounded-xl transition-colors',
      mobile ? 'flex-col gap-1 px-1 py-1.5 text-[11px] shrink-0' : 'px-3 py-2.5 text-sm',
      isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    );

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-l border-slate-800 bg-slate-900/60 p-4 sticky top-0 h-screen">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold">Account Manager</div>
          <div className="text-xs text-slate-500">{user.name} · {user.role === 'owner' ? 'בעלים' : 'חבר להקה'}</div>
        </div>
        <nav className="space-y-1 flex-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => linkClass(isActive)}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-400 hover:text-rose-400">
          <LogOut size={18} /> התנתקות
        </button>
      </aside>

      {/* main */}
      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 max-w-6xl mx-auto w-full">
        <Outlet />
      </main>

      {/* Mobile bottom nav. Tight padding keeps the whole owner nav plus יציאה inside a phone
          width; the horizontal scroll is the safety valve on the narrowest screens, so no
          destination is ever simply unreachable. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800 flex justify-around overflow-x-auto px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => linkClass(isActive, true)}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <button onClick={logout} className="flex flex-col items-center gap-1 px-1 py-1.5 text-[11px] text-slate-400 shrink-0">
          <LogOut size={20} /> יציאה
        </button>
      </nav>
    </div>
  );
}
