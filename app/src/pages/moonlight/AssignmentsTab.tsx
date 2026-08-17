import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { del, get, post, put, nis } from '../../api';
import { Button, Card, DataTable, Input, Modal, PageHeader, PeriodSelect, SearchInput, textMatch } from '../../ui';
import { ASSIGNMENT_ROLES, roleName, type PeriodTabProps } from './shared';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The staffing board (שיבוצים): who works each show, matched from the calendar guest list
 * where the supplier table knows the email, decided by hand where it does not.
 *
 * Three pieces: an alert for upcoming shows missing someone, the show-by-role grid, and the
 * supplier table itself — each supplier with the open debt across the shows they worked.
 */
export function AssignmentsTab({ isOwner, onError, period }: PeriodTabProps) {
  const [events, setEvents] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [supplierModal, setSupplierModal] = useState<any | null>(null);
  const [debtsFor, setDebtsFor] = useState<any | null>(null);
  const [matching, setMatching] = useState(false);

  const load = () => {
    const query = period.params().toString();
    get(`/moonlight/assignments${query ? `?${query}` : ''}`)
      .then((d) => { setEvents(d.events); setSuppliers(d.suppliers); })
      .catch((e) => onError(e.message));
  };
  useEffect(load, [period.year, period.month]);

  const assign = async (eventId: string, role: string, value: string) => {
    try {
      await put(`/moonlight/events/${eventId}/assignments`, {
        role,
        supplier_id: value === '' || value === 'none' ? null : value,
        not_needed: value === 'none',
      });
      load();
    } catch (err: any) { onError(err.message); }
  };

  const saveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = supplierModal;
    try {
      if (b.id) await put(`/moonlight/suppliers/${b.id}`, b);
      else await post('/moonlight/suppliers', b);
      setSupplierModal(null);
      load();
    } catch (err: any) { onError(err.message); }
  };

  const removeSupplier = async (supplier: any) => {
    if (!confirm(`למחוק את «${supplier.name}»? השיבוצים שלו יימחקו גם הם.`)) return;
    try { await del(`/moonlight/suppliers/${supplier.id}`); load(); }
    catch (err: any) { onError(err.message); }
  };

  const autoMatch = async () => {
    setMatching(true);
    onError('');
    try {
      const d = await post('/moonlight/assignments/auto-match');
      if (!d.assigned) onError('לא נמצאו התאמות חדשות בין אורחי היומן לספקים');
      load();
    } catch (err: any) { onError(err.message); }
    finally { setMatching(false); }
  };

  const visible = events.filter((e) => textMatch(search, e.venue));
  const upcomingMissing = events.filter((e) => e.date >= today() && e.missing.length > 0);

  return (
    <div className="space-y-3">
      {upcomingMissing.length > 0 && (
        <Card className="border-warn/25">
          <div className="font-bold text-warn mb-2">
            ⚠ {upcomingMissing.length} הופעות קרובות עם שיבוץ חסר
          </div>
          <div className="space-y-1 text-sm">
            {upcomingMissing.slice(0, 6).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.venue}</span>
                <span className="text-xs text-faint">{e.date}</span>
                <span className="text-warn text-xs">
                  חסר: {e.missing.map((r: string) => roleName(r)).join(', ')}
                </span>
              </div>
            ))}
            {upcomingMissing.length > 6 && (
              <div className="text-xs text-faint">ועוד {upcomingMissing.length - 6} הופעות…</div>
            )}
          </div>
        </Card>
      )}

      <PageHeader
        title="שיבוצים להופעות"
        actions={
          <>
            <PeriodSelect year={period.year} month={period.month}
              onYearChange={period.setYear} onMonthChange={period.setMonth} />
            <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי מקום…" className="w-40" />
            {isOwner && (
              <span title="משווה את רשימת האורחים של כל הופעה מהיומן לאימיילים של הספקים">
                <Button variant="ghost" disabled={matching} onClick={autoMatch}>
                  {matching ? 'מתאים…' : 'התאמה מהיומן'}
                </Button>
              </span>
            )}
          </>
        }
      />

      <div>
          <DataTable
            empty="אין הופעות בטווח הזה"
            rows={visible}
            rowKey={(e) => e.id}
            rowClassName={(e) => clsx('hover:bg-soft',
              e.date >= today() && e.missing.length > 0 && 'bg-warn-soft')}
            columns={[
              {
                key: 'venue', header: 'מקום', mobile: 'title', sortValue: (e) => e.venue, className: 'font-medium',
                render: (e) => (
                  <div className="flex items-center gap-1.5">
                    {e.calendar_event_id && <span title="מסונכרן מהיומן" className="text-accent text-xs">◷</span>}
                    <span>{e.venue}</span>
                  </div>
                ),
              },
              {
                key: 'date', header: 'תאריך', sortValue: (e) => e.date, className: 'whitespace-nowrap',
                render: (e) => e.date,
              },
              ...ASSIGNMENT_ROLES.map((role) => ({
                key: role.key,
                header: role.name,
                label: role.name,
                render: (e: any) => (
                  <RoleCell
                    event={e}
                    role={role}
                    suppliers={suppliers}
                    isOwner={isOwner}
                    onAssign={(value) => assign(e.id, role.key, value)}
                  />
                ),
              })),
            ]}
          />
        <p className="text-xs text-faint mt-3">
          שיבוץ עם ◷ הותאם אוטומטית מרשימת האורחים ביומן; הסכום מתחת לכל שיבוץ הוא שכר התפקיד
          מתוך הוצאות ההופעה — אדום כל עוד לא שולם, ירוק לאחר תשלום.
        </p>
      </div>

      <div className="pt-2">
        <PageHeader
          title="ספקים"
          sub="התאמת אימייל לתפקיד — כך אורח ביומן הופך לשיבוץ"
          actions={isOwner && (
            <Button onClick={() => setSupplierModal({ name: '', email: '', role: 'soundman', phone: '', notes: '' })}>
              + ספק
            </Button>
          )}
        />
        <div className="mt-4">
          <DataTable
            empty="עדיין אין ספקים — הוסיפו ספק כדי להתחיל לשבץ"
            rows={suppliers}
            rowKey={(s) => s.id}
            columns={[
              { key: 'name', header: 'שם', mobile: 'title', sortValue: (s) => s.name, className: 'font-medium', render: (s) => s.name },
              {
                key: 'role', header: 'תפקיד', sortValue: (s) => roleName(s.role),
                render: (s) => roleName(s.role),
              },
              {
                key: 'email', header: 'אימייל', sortValue: (s) => s.email,
                render: (s) => <span dir="ltr">{s.email || '—'}</span>,
              },
              { key: 'phone', header: 'טלפון', render: (s) => <span dir="ltr">{s.phone || '—'}</span> },
              {
                key: 'owed', header: 'חוב פתוח', sortValue: (s) => Number(s.owed) || 0,
                render: (s) => s.owed > 0 ? (
                  <button
                    onClick={() => setDebtsFor(s)}
                    title="פירוט החוב לפי הופעה"
                    className="text-neg font-medium hover:underline"
                  >
                    {nis(s.owed)} · {s.owed_shows.length} הופעות
                  </button>
                ) : <span className="text-pos">—</span>,
              },
              isOwner && {
                key: 'actions', mobile: 'actions' as const, className: 'text-left whitespace-nowrap',
                render: (s: any) => (
                  <div className="flex gap-3 md:gap-2 justify-end">
                    <button onClick={() => setSupplierModal({ ...s })} className="text-sm text-accent hover:underline">עריכה</button>
                    <button onClick={() => removeSupplier(s)} className="text-sm text-neg hover:underline">מחיקה</button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      <Modal title={supplierModal?.id ? 'עריכת ספק' : 'ספק חדש'} open={!!supplierModal} onClose={() => setSupplierModal(null)}>
        {supplierModal && (
          <form onSubmit={saveSupplier} className="space-y-3">
            <Input label="שם *" value={supplierModal.name} required
              onChange={(e) => setSupplierModal({ ...supplierModal, name: e.target.value })} />
            <label className="block">
              <span className="block text-sm text-muted mb-1">תפקיד *</span>
              <select value={supplierModal.role}
                onChange={(e) => setSupplierModal({ ...supplierModal, role: e.target.value })}
                className="w-full bg-soft border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent">
                {ASSIGNMENT_ROLES.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </label>
            <Input label="אימייל (להתאמה מול אורחי היומן)" type="email" dir="ltr" value={supplierModal.email || ''}
              onChange={(e) => setSupplierModal({ ...supplierModal, email: e.target.value })} />
            <Input label="טלפון" dir="ltr" value={supplierModal.phone || ''}
              onChange={(e) => setSupplierModal({ ...supplierModal, phone: e.target.value })} />
            <Input label="הערות" value={supplierModal.notes || ''}
              onChange={(e) => setSupplierModal({ ...supplierModal, notes: e.target.value })} />
            <Button type="submit" className="w-full">שמירה</Button>
          </form>
        )}
      </Modal>

      <Modal title={debtsFor ? `חוב פתוח — ${debtsFor.name}` : ''} open={!!debtsFor} onClose={() => setDebtsFor(null)}>
        {debtsFor && (
          <div className="space-y-2">
            {debtsFor.owed_shows.map((row: any) => (
              <div key={`${row.event_id}-${row.role}`}
                className="flex items-center justify-between text-sm border-b border-line pb-2 last:border-0">
                <div>
                  <div className="font-medium">{row.venue}</div>
                  <div className="text-xs text-faint">{row.date} · {roleName(row.role)}</div>
                </div>
                <span className="text-neg font-medium">{nis(row.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 font-bold">
              <span>סה״כ</span>
              <span className="text-neg">{nis(debtsFor.owed)}</span>
            </div>
            <p className="text-xs text-faint">
              הסימון «שולם» נעשה בלשונית «הוצאות הופעות», בשורת ההופעה המתאימה.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * One role on one show: the picker of that role's suppliers (plus «לא נדרש»), and beneath it
 * the role's fee from the show's expense row — the per-supplier, per-show debt.
 */
function RoleCell({ event, role, suppliers, isOwner, onAssign }: {
  event: any;
  role: { key: string; name: string; required: boolean };
  suppliers: any[];
  isOwner: boolean;
  onAssign: (value: string) => void;
}) {
  const assignment = event.roles[role.key];
  const amount = event.amounts[role.key];
  const missing = !assignment && role.required && event.date >= today();
  const options = suppliers.filter((s) => s.role === role.key);
  // Keep an off-role supplier visible if someone assigned them anyway.
  if (assignment?.supplier_id && !options.some((s) => s.id === assignment.supplier_id)) {
    const extra = suppliers.find((s) => s.id === assignment.supplier_id);
    if (extra) options.push(extra);
  }

  const value = assignment ? (assignment.not_needed ? 'none' : assignment.supplier_id || '') : '';

  return (
    <div className="min-w-[7.5rem]">
      {isOwner ? (
        <div className="flex items-center gap-1">
          {assignment?.source === 'calendar' && (
            <span title="הותאם אוטומטית מרשימת האורחים ביומן" className="text-accent text-xs">◷</span>
          )}
          <select
            value={value}
            onChange={(e) => onAssign(e.target.value)}
            className={clsx(
              'w-full bg-soft border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent',
              missing ? 'border-warn/25 text-warn' : 'border-line'
            )}
          >
            <option value="">{missing ? '⚠ לא שובץ' : '—'}</option>
            <option value="none">לא נדרש</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : (
        <span className={clsx('text-sm', missing && 'text-warn')}>
          {assignment?.not_needed ? 'לא נדרש' : assignment?.supplier_name || (missing ? '⚠ לא שובץ' : '—')}
        </span>
      )}
      {amount.amount > 0 && !assignment?.not_needed && (
        <div className={clsx('text-xs mt-0.5', amount.paid ? 'text-pos' : 'text-neg')}
          title={amount.paid ? 'שולם' : 'טרם שולם — מתוך הוצאות ההופעה'}>
          {nis(amount.amount)}{amount.paid ? ' ✓' : ''}
        </div>
      )}
    </div>
  );
}
