import React, { useState } from 'react';
import { put } from '../../api';
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
 * There is no «+ חבר» button. A member's share of every show lives in a column named after
 * them on band_events, so a fifth member would have nowhere to be paid; the roster is fixed
 * until those columns become rows. The note under the table says so rather than leaving
 * somebody hunting for the button.
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
    try {
      await put(`/moonlight/members/${editing.member_key}`, editing);
      setEditing(null);
      reload();
    } catch (err: any) { onError(err.message); }
  };

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
              <button onClick={() => setEditing({ ...m })} className="text-sm text-accent hover:underline">
                עריכה
              </button>
            ),
          },
        ]}
      />

      <p className="text-[12.5px] text-faint">
        סוג העסק של כל חבר הוא מה שקובע כיצד חלקו מחושב במחשבון ההעברה ללהקה.
        מספר החברים קבוע — חלקו של כל חבר בכל הופעה שמור בעמודה נפרדת בבסיס הנתונים,
        ולכן הוספה או הסרה של חבר דורשת שינוי מבנה. חבר שאינו פעיל עוד ניתן לסמן «לא פעיל».
      </p>

      <Modal title={`עריכת ${editing?.name ?? 'חבר'}`} open={!!editing} onClose={() => setEditing(null)}>
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
                הוצאה מוכרת כלל.
              </span>
            </label>
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
