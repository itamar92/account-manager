import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, post, put, nis } from '../../api';
import { Button, DataTable, Input, Modal, fieldClass } from '../../ui';
import { BUSINESS_TYPES, businessTypeLabel, useBandMembers, type BandMember } from './shared';

/**
 * Who is in the band, and the handful of facts about each one that the rest of the app needs.
 *
 * The business type is the load-bearing one. It is not paperwork: a member's share of a show
 * comes back as an invoice, and what kind of invoice decides what that share actually costs —
 * an עוסק מורשה's carries reclaimable מע"מ, an עוסק פטור's carries none, and a member who is
 * registered as nothing hands back nothing deductible at all. The transfer calculator reads
 * this table rather than assuming, so getting it right here is what makes that sum right.
 *
 * The roster is the band's real membership, not a fixed list: shares live in their own table,
 * one row per member per show, so a fifth member has somewhere to be paid the moment they are
 * added. Removing one is deliberately harder than adding — see `remove`.
 */
export function MembersPanel({ isOwner, onError }: {
  isOwner: boolean;
  onError: (message: string) => void;
}) {
  const { members, reload } = useBandMembers();
  const [editing, setEditing] = useState<BandMember | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    onError('');
    try {
      if (editing.member_key) await put(`/band/members/${editing.member_key}`, editing);
      else await post('/band/members', editing);
      setEditing(null);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  /**
   * Only ever right for a member entered by mistake. Somebody who has played has shares on
   * those shows — money that was divided — so the server refuses, and «לא פעיל» is the answer.
   */
  const remove = async (m: BandMember) => {
    if (!confirm(`למחוק את ${m.name} מהלהקה?`)) return;
    onError('');
    try {
      await del(`/band/members/${m.member_key}`);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const blank = (): BandMember => ({
    id: '', member_key: '', name: '', email: '', role: '',
    is_manager: 0, business_type: 'patur', active: 1, sort_order: 0,
  });

  const managers = members.filter((m) => m.is_manager).map((m) => m.name);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="ser text-xl">חברי הלהקה</h2>
          <p className="mt-1 text-[13px] text-muted">
            {members.length
              ? <>{members.filter((m) => m.active).length} חברים פעילים
                  {managers.length > 0 && <> · מנהלים: {managers.join(' ו')}</>}</>
              : 'טוען…'}
          </p>
        </div>
        {isOwner && <Button onClick={() => setEditing(blank())}>+ חבר</Button>}
      </div>

      <DataTable
        empty="אין חברים רשומים"
        rows={members}
        rowKey={(m) => m.member_key}
        rowClassName={(m) => (m.active ? undefined : 'opacity-55')}
        columns={[
          {
            key: 'name', header: 'שם', mobile: 'title', sortValue: (m: BandMember) => m.name,
            className: 'font-medium',
            render: (m: BandMember) => (
              <span className="flex items-center gap-2">
                {m.name}
                {!!m.is_manager && (
                  <span className="bg-accent-soft text-accent-ink text-[11.5px] font-semibold px-2 py-0.5 rounded-full">
                    מנהל
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'role', header: 'תפקיד', sortValue: (m: BandMember) => m.role || '',
            render: (m: BandMember) => m.role || <span className="text-faint">—</span>,
          },
          {
            key: 'business', header: 'סוג עסק', sortValue: (m: BandMember) => m.business_type,
            render: (m: BandMember) => (
              <span className={m.business_type === 'none' ? 'text-warn' : 'text-ink-2'}>
                {businessTypeLabel(m.business_type)}
              </span>
            ),
          },
          {
            // The consequence of the column before it: a member who is an עוסק owes the band an
            // invoice for every share it has paid them, and until it arrives that share is not
            // a deductible expense.
            key: 'missing_docs', header: 'חסרות חשבוניות',
            sortValue: (m: BandMember) => Number(m.missing_docs) || 0,
            render: (m: BandMember) => {
              if (m.business_type === 'none') {
                return <span className="text-faint" title="לא רשום — אין חשבונית לצפות לה">—</span>;
              }
              if (!(Number(m.missing_docs) > 0)) return <span className="text-pos">—</span>;
              return (
                <Link to="/band/supplierPayments" className="flex flex-col items-start gap-0.5 hover:underline">
                  <span className="num text-warn font-medium">{nis(m.missing_docs)}</span>
                  <span className="text-[11.5px] text-faint whitespace-nowrap">
                    {m.missing_doc_payments} תשלומים · הוותיק לפני {m.missing_docs_days} ימים
                  </span>
                </Link>
              );
            },
          },
          {
            key: 'email', header: 'אימייל', sortValue: (m: BandMember) => m.email || '',
            render: (m: BandMember) => <span dir="ltr">{m.email || '—'}</span>,
          },
          {
            key: 'active', header: 'סטטוס',
            // Not a StatusBadge: that vocabulary is about invoices and expenses, and it would
            // have an active member reading as «שולם».
            render: (m: BandMember) => (
              <span className={`inline-block px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${
                m.active ? 'bg-pos-soft text-pos' : 'bg-soft text-muted'
              }`}>
                {m.active ? 'פעיל' : 'לא פעיל'}
              </span>
            ),
          },
          isOwner && {
            key: 'actions', mobile: 'actions' as const, className: 'text-left whitespace-nowrap',
            render: (m: BandMember) => (
              <div className="flex gap-3 md:gap-2 justify-end">
                <button onClick={() => setEditing({ ...m })} className="text-sm text-accent hover:underline">
                  עריכה
                </button>
                <button onClick={() => remove(m)} className="text-sm text-neg hover:underline">
                  מחיקה
                </button>
              </div>
            ),
          },
        ]}
      />

      <p className="text-[12.5px] text-faint">
        סוג העסק קובע כיצד חלקו של כל חבר מחושב במחשבון ההעברה ללהקה, ודמי ההפקה מתחלקים בין
        המנהלים. חלוקת הרווח בהופעה חדשה נגזרת ממספר החברים הפעילים — הוספה או הסרה משנה אותה
        מכאן והלאה, אך אינה נוגעת בהופעות שכבר חולקו. חבר שעזב יש לסמן «לא פעיל» ולא למחוק:
        כך חלקו בהופעות שניגן בהן נשמר, והוא ממשיך להופיע בסקירה עד שיקבל את כספו.
        אגורות העיגול נופלות תמיד על החבר שהאימייל שלו הוא זה של בעל החשבון, כדי שסכום החלקים
        יישאר שווה בדיוק לרווח.
      </p>

      <Modal
        title={editing?.member_key ? `עריכת ${editing.name}` : 'חבר חדש'}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <form onSubmit={save} className="space-y-3">
            <Input
              label="שם *" value={editing.name} required
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label="תפקיד בלהקה" placeholder="גיטרה, שירה, תופים…" value={editing.role || ''}
              onChange={(e) => setEditing({ ...editing, role: e.target.value })}
            />
            <Input
              label="אימייל" type="email" dir="ltr" value={editing.email || ''}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
            />
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">סוג עסק *</span>
              <select
                value={editing.business_type} className={fieldClass}
                onChange={(e) => setEditing({ ...editing, business_type: e.target.value as any })}
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <span className="block text-[12px] text-faint mt-1.5">
                קובע אם החשבונית שהחבר מוציא על חלקו מזכה בקיזוז מע"מ, מוכרת ללא מע"מ, או אינה
                הוצאה מוכרת כלל. «לא רשום» גם אומר שלא נחכה לחשבונית על חלקו.
              </span>
            </label>
            {editing.business_type !== 'none' && (
              <div className="border-t border-line pt-3 space-y-3">
                <p className="text-[12px] text-faint">
                  זיהוי החשבוניות שהחבר מוציא על חלקו — בדיוק כמו אצל ספק. השם על החשבונית הוא
                  שם העסק שלו ולא שמו בלהקה, ואותו רושמים בלשונית «שמות בחשבוניות».
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="ח.פ / ת.ז" dir="ltr" value={editing.tax_id || ''}
                    onChange={(e) => setEditing({ ...editing, tax_id: e.target.value })}
                  />
                  <Input
                    label="מזהה ספק ב־Morning" dir="ltr"
                    value={editing.morning_supplier_id || ''}
                    onChange={(e) => setEditing({ ...editing, morning_supplier_id: e.target.value })}
                  />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox" checked={!!editing.is_manager} className="accent-accent"
                onChange={(e) => setEditing({ ...editing, is_manager: e.target.checked ? 1 : 0 })}
              />
              מנהל — שותף בניהול העסקי של הלהקה, ובדמי ההפקה
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox" checked={!!editing.active} className="accent-accent"
                onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })}
              />
              פעיל בלהקה
            </label>
            <Button type="submit" className="w-full">שמירה</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
