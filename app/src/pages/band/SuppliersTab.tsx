import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, put, nis } from '../../api';
import { Button, DataTable, Input, Modal, PageHeader, fieldClass } from '../../ui';
import { roleName, useSupplierRoles, type SupplierRole, type TabProps } from './shared';
import { MembersPanel } from './MembersPanel';
import { PaySupplierModal } from './SupplierPaymentsTab';
import { SupplierRolesPanel } from './SupplierRolesPanel';
import { ExpenseCategoriesPanel } from './ExpenseCategoriesPanel';

/**
 * Who the band hires, and what it still owes them.
 *
 * The show-by-show staffing grid this page used to carry moved onto the show itself, where the
 * name and the fee sit on the same line. What is left is the part that is genuinely about the
 * supplier rather than about one gig: their email — which is what turns a calendar guest into
 * a staffed role — their standing fee, which staffing them writes onto the show, and their
 * open debt across every show they have already played.
 */
/** A role's name out of a list that may still be loading — for a note about the one just picked. */
const roleNameOf = (roles: SupplierRole[], key: string): string =>
  roles.find((r) => r.key === key)?.name || key;

export function SuppliersTab({ isOwner, onError }: TabProps) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const { roles: allRoles, active: roles, reload: reloadRoles } = useSupplierRoles();
  const [supplierModal, setSupplierModal] = useState<any | null>(null);
  const [debtsFor, setDebtsFor] = useState<any | null>(null);
  const [matching, setMatching] = useState(false);
  // Paying is started from here as well as from the payments page: this is where you notice
  // somebody is owed for four gigs, and it is one transfer, not four.
  const [payFor, setPayFor] = useState<string | null>(null);

  const load = () => {
    get('/band/assignments')
      .then((d) => setSuppliers(d.suppliers))
      .catch((e) => onError(e.message));
  };
  useEffect(load, []);

  const saveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = supplierModal;
    try {
      if (b.id) await put(`/band/suppliers/${b.id}`, b);
      else await post('/band/suppliers', b);
      setSupplierModal(null);
      load();
    } catch (err: any) { onError(err.message); }
  };

  const removeSupplier = async (supplier: any) => {
    // Payments cascade with the supplier, so the warning says so: what goes is the band's own
    // record of what it paid them, and the queue that was waiting on their invoices.
    const extra = Number(supplier.missing_docs) > 0
      ? ` כולל ${supplier.missing_doc_payments} תשלומים שממתינים לחשבונית.`
      : '';
    if (!confirm(`למחוק את «${supplier.name}»? השיבוצים והתשלומים הרשומים לו יימחקו גם הם.${extra}`)) return;
    try { await del(`/band/suppliers/${supplier.id}`); load(); }
    catch (err: any) { onError(err.message); }
  };

  const autoMatch = async () => {
    setMatching(true);
    onError('');
    try {
      const d = await post('/band/assignments/auto-match');
      if (!d.assigned) onError('לא נמצאו התאמות חדשות בין אורחי היומן לספקים');
      load();
    } catch (err: any) { onError(err.message); }
    finally { setMatching(false); }
  };

  // The debt is only what past shows left unpaid — see supplierDebts on the server. A fee
  // sitting on a show next month is money the band will owe, not money it owes, so it is
  // reported as its own figure instead of being folded into the total.
  const owedTotal = suppliers.reduce((sum, s) => sum + (Number(s.owed) || 0), 0);
  const upcomingTotal = suppliers.reduce((sum, s) => sum + (Number(s.upcoming) || 0), 0);
  // The mirror of the debt: money that has already gone out and has no document behind it.
  const missingDocsTotal = suppliers.reduce((sum, s) => sum + (Number(s.missing_docs) || 0), 0);
  const upcomingNote = upcomingTotal > 0
    ? <> · <span className="num">{nis(upcomingTotal)}</span> משובץ בהופעות עתידיות</>
    : null;

  return (
    <div className="space-y-7">
      {/* The band comes before the people it hires: this page is called «ספקים וחברים», and
          who is in the band is the part the rest of the app reads back. */}
      <MembersPanel isOwner={isOwner} onError={onError} />

      <ExpenseCategoriesPanel isOwner={isOwner} onError={onError} onChange={() => { reloadRoles(); load(); }} />

      <SupplierRolesPanel isOwner={isOwner} onError={onError} onChange={() => { reloadRoles(); load(); }} />

      <div className="space-y-4">
      <PageHeader
        title="ספקים"
        sub={owedTotal > 0
          ? <>חוב פתוח לספקים <span className="num text-neg">{nis(owedTotal)}</span>{upcomingNote}</>
          : <>אין חובות פתוחים לספקים{upcomingNote}</>}
        actions={isOwner && (
          <>
            <span title="משווה את רשימת האורחים של כל הופעה מהיומן לאימיילים של הספקים">
              <Button variant="ghost" disabled={matching} onClick={autoMatch}>
                {matching ? 'מתאים…' : 'התאמה מהיומן'}
              </Button>
            </span>
            <Button onClick={() => setSupplierModal({ name: '', email: '', role: roles[0]?.key || 'soundman', phone: '', notes: '', default_amount: 0, tax_id: '', morning_supplier_id: '', aliases: '', expects_invoice: true })}>
              + ספק
            </Button>
          </>
        )}
      />

      <p className="text-[13px] text-muted">
        אימייל של ספק הוא מה שהופך אורח ביומן לשיבוץ, ותעריף קבוע נכנס לבד לשורת העלות כששיבצתם אותו.
        החוב נספר רק מהופעות שכבר היו. «תשלום» כאן סוגר כמה הופעות בהעברה אחת, וההעברה היא מה
        שממתין לחשבונית — ראו <Link to="/band/supplierPayments" className="text-accent hover:underline">תשלומים לספקים</Link>.
        ח.פ/ת.ז הוא מה שמאפשר לשייך חשבונית מ־Morning לתשלום בוודאות, וכשאין —{' '}
        <Link to="/band/supplierNames" className="text-accent hover:underline">שם החשבונית</Link>{' '}
        עושה את אותה עבודה.
      </p>

      {missingDocsTotal > 0 && (
        <div className="text-[13px] bg-warn-soft text-warn rounded-xl px-4 py-2.5">
          <span className="num font-semibold">{nis(missingDocsTotal)}</span> שולמו וטרם התקבלה עליהם חשבונית ·{' '}
          <Link to="/band/supplierPayments" className="underline">לרשימה</Link>
        </div>
      )}

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
            key: 'default_amount', header: 'תעריף קבוע', sortValue: (s) => Number(s.default_amount) || 0,
            render: (s) => Number(s.default_amount) > 0
              ? <span className="num">{nis(s.default_amount)}</span>
              : <span className="text-faint">—</span>,
          },
          {
            key: 'owed', header: 'חוב פתוח', sortValue: (s) => Number(s.owed) || 0,
            render: (s) => (
              <div className="flex flex-col items-start gap-0.5">
                {s.owed > 0 ? (
                  <button
                    onClick={() => setDebtsFor(s)}
                    title="פירוט החוב לפי הופעה"
                    className="num text-neg font-medium hover:underline"
                  >
                    {nis(s.owed)} · {s.owed_shows.length} הופעות
                  </button>
                ) : <span className="text-pos">—</span>}
                {Number(s.upcoming) > 0 && (
                  <span className="text-[11.5px] text-faint whitespace-nowrap">
                    ועוד <span className="num">{nis(s.upcoming)}</span> ב־{s.upcoming_shows.length} הופעות שטרם היו
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'missing_docs', header: 'חסרות חשבוניות',
            sortValue: (s: any) => Number(s.missing_docs) || 0,
            render: (s: any) => {
              if (!s.expects_invoice) return <span className="text-faint" title="לא מצפים מהספק הזה לחשבונית">—</span>;
              if (!(Number(s.missing_docs) > 0)) return <span className="text-pos">—</span>;
              return (
                <Link to="/band/supplierPayments" className="flex flex-col items-start gap-0.5 hover:underline">
                  <span className="num text-warn font-medium">{nis(s.missing_docs)}</span>
                  <span className="text-[11.5px] text-faint whitespace-nowrap">
                    {s.missing_doc_payments} תשלומים · הוותיק לפני {s.missing_docs_days} ימים
                  </span>
                </Link>
              );
            },
          },
          isOwner && {
            key: 'actions', mobile: 'actions' as const, className: 'text-left whitespace-nowrap',
            render: (s: any) => (
              <div className="flex gap-3 md:gap-2 justify-end">
                {Number(s.owed) > 0 && (
                  <button onClick={() => setPayFor(s.id)} className="text-sm text-accent hover:underline">תשלום</button>
                )}
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
                {roles.map((r: SupplierRole) => <option key={r.key} value={r.key}>{r.name}</option>)}
                {/* The types the band has switched off are offered rather than hidden: needing
                    one is exactly the moment you find out you hire for it, and hiring somebody
                    turns it on. Hiding them made «הוסיפו ספק צמידים» a dead end. */}
                {allRoles.filter((r: SupplierRole) => !r.active).length > 0 && (
                  <optgroup label="סוגים שאינם פעילים — ייפתחו עם השמירה">
                    {allRoles.filter((r: SupplierRole) => !r.active).map((r: SupplierRole) => (
                      <option key={r.key} value={r.key}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {allRoles.some((r: SupplierRole) => !r.active && r.key === supplierModal.role) && (
                <span className="block text-[12px] text-faint mt-1.5">
                  «{roleNameOf(allRoles, supplierModal.role)}» כבוי כרגע — שמירת הספק תפעיל אותו,
                  ומעכשיו אפשר יהיה לשבץ אותו בהופעות ולשלם לו.
                </span>
              )}
            </label>
            <Input label="אימייל (להתאמה מול אורחי היומן)" type="email" dir="ltr" value={supplierModal.email || ''}
              onChange={(e) => setSupplierModal({ ...supplierModal, email: e.target.value })} />
            <Input label="טלפון" dir="ltr" value={supplierModal.phone || ''}
              onChange={(e) => setSupplierModal({ ...supplierModal, phone: e.target.value })} />
            <Input
              label="תעריף קבוע (נכנס לבד לשורת העלות בשיבוץ)"
              type="number" min="0" dir="ltr"
              value={supplierModal.default_amount ?? 0}
              onChange={(e) => setSupplierModal({ ...supplierModal, default_amount: e.target.value })}
            />
            <p className="text-[12px] text-faint -mt-1">
              0 = אין תעריף קבוע. סכום שהוקלד ידנית בהופעה לא יידרס.
            </p>
            <div className="border-t border-line pt-3 space-y-3">
              <p className="text-[12px] text-faint">
                שיוך חשבוניות מ־Morning: ח.פ/ת.ז הוא זיהוי ודאי ומאפשר שיוך אוטומטי; שם חלופי הוא
                רק רמז, ומציע התאמה לאישור שלכם.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="ח.פ / ת.ז" dir="ltr" value={supplierModal.tax_id || ''}
                  onChange={(e) => setSupplierModal({ ...supplierModal, tax_id: e.target.value })} />
                <Input label="מזהה ספק ב־Morning" dir="ltr" value={supplierModal.morning_supplier_id || ''}
                  onChange={(e) => setSupplierModal({ ...supplierModal, morning_supplier_id: e.target.value })} />
              </div>
              <Input
                label="שמות חלופיים (השם על החשבונית, מופרד בפסיקים)"
                value={supplierModal.aliases || ''}
                onChange={(e) => setSupplierModal({ ...supplierModal, aliases: e.target.value })}
              />
              <p className="text-[12px] text-faint -mt-1">
                שם שנרשם כאן מספיק לשיוך אוטומטי, בדיוק כמו ח.פ. את כל השמות יחד — ואת השמות
                שהגיעו על מסמכים ואינם מוכרים לאף ספק — רואים בלשונית «שמות בחשבוניות».
              </p>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={supplierModal.expects_invoice ?? true}
                  onChange={(e) => setSupplierModal({ ...supplierModal, expects_invoice: e.target.checked })}
                />
                מצפים לחשבונית מהספק הזה
              </label>
              <p className="text-[12px] text-faint -mt-1">
                כבו את זה למי שלעולם לא מוציא חשבונית — אחרת התשלומים אליו יישארו ברשימת ההמתנה
                לנצח, ורשימה שאי אפשר לרוקן היא רשימה שמפסיקים לפתוח.
              </p>
            </div>
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
                to={`/band/shows/${row.event_id}`}
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
              לחיצה על שורה פותחת את ההופעה, ושם מסמנים «שולם». נספרות רק הופעות שכבר היו.
            </p>
            {debtsFor.upcoming > 0 && (
              <div className="pt-2 border-t border-line">
                <div className="text-xs text-faint mb-1.5">
                  משובץ בהופעות שטרם היו — <span className="num">{nis(debtsFor.upcoming)}</span>, עדיין לא חוב
                </div>
                {debtsFor.upcoming_shows.map((row: any) => (
                  <Link
                    key={`${row.event_id}-${row.role}`}
                    to={`/band/shows/${row.event_id}`}
                    onClick={() => setDebtsFor(null)}
                    className="flex items-center justify-between text-sm py-1 hover:bg-soft rounded px-1 -mx-1"
                  >
                    <div>
                      <div className="text-muted">{row.venue}</div>
                      <div className="text-xs text-faint">{row.date} · {roleName(row.role)}</div>
                    </div>
                    <span className="num text-muted">{nis(row.amount)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <PaySupplierModal
        open={!!payFor}
        suppliers={suppliers}
        initialSupplierId={payFor || ''}
        onClose={() => setPayFor(null)}
        onSaved={() => { setPayFor(null); load(); }}
        onError={onError}
      />
      </div>
    </div>
  );
}
