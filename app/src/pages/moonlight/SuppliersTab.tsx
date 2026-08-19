import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, put, nis } from '../../api';
import { Button, DataTable, Input, Modal, PageHeader, fieldClass } from '../../ui';
import { ASSIGNMENT_ROLES, roleName, type TabProps } from './shared';
import { MembersPanel } from './MembersPanel';

/**
 * Who the band hires, and what it still owes them.
 *
 * The show-by-show staffing grid this page used to carry moved onto the show itself, where the
 * name and the fee sit on the same line. What is left is the part that is genuinely about the
 * supplier rather than about one gig: their email — which is what turns a calendar guest into
 * a staffed role — and their open debt across every show they worked.
 */
export function SuppliersTab({ isOwner, onError }: TabProps) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierModal, setSupplierModal] = useState<any | null>(null);
  const [debtsFor, setDebtsFor] = useState<any | null>(null);
  const [matching, setMatching] = useState(false);

  const load = () => {
    get('/moonlight/assignments')
      .then((d) => setSuppliers(d.suppliers))
      .catch((e) => onError(e.message));
  };
  useEffect(load, []);

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

  const owedTotal = suppliers.reduce((sum, s) => sum + (Number(s.owed) || 0), 0);

  return (
    <div className="space-y-7">
      {/* The band comes before the people it hires: this page is called «ספקים וחברים», and
          who is in the band is the part the rest of the app reads back. */}
      <MembersPanel isOwner={isOwner} onError={onError} />

      <div className="space-y-4">
      <PageHeader
        title="ספקים"
        sub={owedTotal > 0
          ? <>חוב פתוח לספקים <span className="num text-neg">{nis(owedTotal)}</span></>
          : 'אין חובות פתוחים לספקים'}
        actions={isOwner && (
          <>
            <span title="משווה את רשימת האורחים של כל הופעה מהיומן לאימיילים של הספקים">
              <Button variant="ghost" disabled={matching} onClick={autoMatch}>
                {matching ? 'מתאים…' : 'התאמה מהיומן'}
              </Button>
            </span>
            <Button onClick={() => setSupplierModal({ name: '', email: '', role: 'soundman', phone: '', notes: '' })}>
              + ספק
            </Button>
          </>
        )}
      />

      <p className="text-[13px] text-muted">
        אימייל של ספק הוא מה שהופך אורח ביומן לשיבוץ. השיבוץ עצמו ותשלום החוב נעשים בעמוד ההופעה.
      </p>

      <DataTable
        empty="עדיין אין ספקים — הוסיפו ספק כדי להתחיל לשבץ"
        rows={suppliers}
        rowKey={(s) => s.id}
        columns={[
          { key: 'name', header: 'שם', mobile: 'title', sortValue: (s) => s.name, className: 'font-medium', render: (s) => s.name },
          { key: 'role', header: 'תפקיד', sortValue: (s) => roleName(s.role), render: (s) => roleName(s.role) },
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
                className="num text-neg font-medium hover:underline"
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

      <Modal title={supplierModal?.id ? 'עריכת ספק' : 'ספק חדש'} open={!!supplierModal} onClose={() => setSupplierModal(null)}>
        {supplierModal && (
          <form onSubmit={saveSupplier} className="space-y-3">
            <Input label="שם *" value={supplierModal.name} required
              onChange={(e) => setSupplierModal({ ...supplierModal, name: e.target.value })} />
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">תפקיד *</span>
              <select value={supplierModal.role}
                onChange={(e) => setSupplierModal({ ...supplierModal, role: e.target.value })}
                className={fieldClass}>
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
              <Link
                key={`${row.event_id}-${row.role}`}
                to={`/moonlight/shows/${row.event_id}`}
                onClick={() => setDebtsFor(null)}
                className="flex items-center justify-between text-sm border-b border-line pb-2 last:border-0 hover:bg-soft rounded px-1 -mx-1"
              >
                <div>
                  <div className="font-medium">{row.venue}</div>
                  <div className="text-xs text-faint">{row.date} · {roleName(row.role)}</div>
                </div>
                <span className="num text-neg font-medium">{nis(row.amount)}</span>
              </Link>
            ))}
            <div className="flex items-center justify-between pt-2 font-bold">
              <span>סה״כ</span>
              <span className="num text-neg">{nis(debtsFor.owed)}</span>
            </div>
            <p className="text-xs text-faint">
              לחיצה על שורה פותחת את ההופעה, ושם מסמנים «שולם».
            </p>
          </div>
        )}
      </Modal>
      </div>
    </div>
  );
}
