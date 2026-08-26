import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { get, post, put, del, nis } from '../api';
import { Button, Card, DataTable, Empty, Input, Modal, Switch } from '../ui';

/**
 * רכוש קבוע — the 1342 schedule, and the form for keeping it.
 *
 * The one field worth explaining is יתרת פתיחה. A real schedule rarely matches what a clean
 * formula would produce — an asset can sit unclaimed for a year, or arrive mid-life with a
 * change of accountant — so the schedule is rolled forward from a stated opening balance
 * rather than recomputed from the purchase date. Copy פחת שנצבר off the last 1342, say which
 * year it was stated at the end of, and every year after it follows the accountant's exactly.
 */
export function FixedAssets({ year, onChanged }: { year: number; onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    get(`/tax/assets?year=${year}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [year]);

  const remove = async (asset: any) => {
    setError('');
    try {
      await del(`/tax/assets/${asset.id}`);
      load();
      onChanged?.();
    } catch (err: any) { setError(err.message); }
  };

  if (!data) return <Empty text="טוען…" />;
  const { schedule } = data;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="ser text-lg">רכוש קבוע ופחת {year}</h2>
        <Button variant="ghost" onClick={() => setEditing({})}><Plus size={14} /> הוספת נכס</Button>
      </div>
      <p className="text-xs text-faint mb-4">
        הספרים ניכו כל רכישה במלואה בחודש שבו נרשמה — נכון למע"מ. הדוח השנתי מהוון אותה ומפחית
        אותה לאורך חיי הנכס. ההפרש הוא עיתוי, לא טעות, והוא מוצג כשורת תיאום למעלה.
      </p>

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5 mb-3">{error}</div>}

      {schedule.rows.length === 0 ? (
        <Empty text="אין נכסים רשומים. אפשר להעתיק אותם מטופס 1342 האחרון." />
      ) : (
        <>
          <DataTable
            rows={schedule.rows}
            rowKey={(r: any) => r.asset.id}
            columns={[
              {
                key: 'name', header: 'נכס', mobile: 'title', className: 'font-medium',
                render: (r: any) => (
                  <span>
                    {r.asset.name}
                    {r.asset.asset_group && <span className="block text-xs text-faint">{r.asset.asset_group}</span>}
                  </span>
                ),
              },
              {
                key: 'purchase', header: 'רכישה', sortValue: (r: any) => r.asset.purchase_date,
                className: 'whitespace-nowrap text-muted', render: (r: any) => r.asset.purchase_date,
              },
              {
                key: 'cost', header: 'עלות', sortValue: (r: any) => r.asset.cost,
                className: 'whitespace-nowrap', render: (r: any) => nis(r.asset.cost),
              },
              {
                key: 'rate', header: 'שיעור', sortValue: (r: any) => r.asset.rate,
                className: 'whitespace-nowrap text-muted',
                render: (r: any) => `${Math.round(r.asset.rate * 1000) / 10}%`,
              },
              {
                key: 'claimed', header: 'פחת השנה', sortValue: (r: any) => r.claimed,
                className: 'whitespace-nowrap text-neg',
                render: (r: any) => (
                  <span>
                    {nis(r.claimed)}
                    {/* Where the claimed rate parts company with the statutory one, say which
                        of the two reasons it was — they are not the same fact. */}
                    {r.short_year && (
                      <span className="block text-xs text-faint">
                        {r.effective_rate}% — {r.short_year === 'final' ? 'שנה אחרונה' : 'שנה חלקית'}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: 'accumulated', header: 'פחת שנצבר', sortValue: (r: any) => r.accumulated_end,
                className: 'whitespace-nowrap text-muted', render: (r: any) => nis(r.accumulated_end),
              },
              {
                key: 'book', header: 'עלות מופחתת', sortValue: (r: any) => r.book_value,
                className: 'whitespace-nowrap font-medium', render: (r: any) => nis(r.book_value),
              },
              {
                key: 'actions', header: '', label: 'פעולות', mobile: 'actions',
                render: (r: any) => (
                  <span className="flex items-center gap-2">
                    <button onClick={() => setEditing(r.asset)} className="text-muted hover:text-ink" aria-label="עריכה">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(r.asset)} className="text-muted hover:text-neg" aria-label="מחיקה">
                      <Trash2 size={15} />
                    </button>
                  </span>
                ),
              },
            ]}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
            <Total label="פחת נתבע השנה" value={nis(schedule.total_claimed)} accent="text-neg" />
            <Total label="תוספות השנה" value={nis(schedule.additions)} />
            <Total label='סה"כ עלות' value={nis(schedule.total_cost)} />
            <Total label="יתרה להפחתה" value={nis(schedule.total_book_value)} accent="text-accent" />
          </div>
          <p className="text-xs text-faint mt-3">
            שנה חלקית מחושבת בבסיס 30/360, כפי שהשומה עורכת אותה. הפחת נעצר כשהנכס הופחת במלואו.
          </p>
        </>
      )}

      <AssetModal
        asset={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); onChanged?.(); }}
      />
    </Card>
  );
}

function Total({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-soft border border-line rounded-xl px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-bold num ${accent || 'text-ink'}`}>{value}</div>
    </div>
  );
}

/** The rates the Ordinance sets for the kinds of thing a business like this actually buys. */
const RATE_PRESETS = [
  { label: 'מיחשוב — 33%', value: '33' },
  { label: 'ציוד וריהוט — 10%', value: '10' },
  { label: 'ציוד — 15%', value: '15' },
  { label: 'ציוד — 20%', value: '20' },
  { label: 'ציוד — 7%', value: '7' },
];

function AssetModal({ asset, onClose, onSaved }: {
  asset: any | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!asset) return;
    setForm({
      name: asset.name ?? '',
      asset_group: asset.asset_group ?? '',
      purchase_date: asset.purchase_date ?? '',
      cost: asset.cost ?? '',
      // Shown as a percentage, which is how a rate is read off a form and typed.
      rate: asset.rate ? String(Math.round(asset.rate * 1000) / 10) : '',
      opening_accumulated: asset.opening_accumulated ?? '',
      opening_year: asset.opening_year ?? '',
      deducted_in_books: asset.deducted_in_books ?? true,
      disposed_date: asset.disposed_date ?? '',
      notes: asset.notes ?? '',
    });
    setError('');
  }, [asset]);

  if (!asset) return null;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        opening_year: form.opening_year === '' ? null : form.opening_year,
        disposed_date: form.disposed_date === '' ? null : form.disposed_date,
      };
      if (asset.id) await put(`/tax/assets/${asset.id}`, body);
      else await post('/tax/assets', body);
      onSaved();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={asset.id ? 'עריכת נכס' : 'נכס חדש'} open onClose={onClose}>
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5 mb-3">{error}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="שם הנכס" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <Input label="קבוצה" placeholder="מיחשוב / ריהוט וציוד" value={form.asset_group}
          onChange={(e) => set({ asset_group: e.target.value })} />
        <Input label="תאריך רכישה" type="date" dir="ltr" value={form.purchase_date}
          onChange={(e) => set({ purchase_date: e.target.value })} />
        <Input label="עלות (לפני מע״מ)" type="number" min="0" step="0.01" dir="ltr" value={form.cost}
          onChange={(e) => set({ cost: e.target.value })} />
        <label className="block">
          <span className="block text-[13px] text-muted mb-1.5">שיעור פחת שנתי (%)</span>
          <div className="flex gap-2">
            <input type="number" min="0" max="100" step="0.1" dir="ltr" value={form.rate}
              onChange={(e) => set({ rate: e.target.value })}
              className="w-full bg-soft border border-line rounded-lg px-3 py-2 text-sm num" />
            <select value="" onChange={(e) => e.target.value && set({ rate: e.target.value })}
              className="bg-soft border border-line rounded-lg px-2 py-2 text-xs shrink-0">
              <option value="">נפוצים…</option>
              {RATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </label>
        <Input label="תאריך גריעה (אם נמכר)" type="date" dir="ltr" value={form.disposed_date}
          onChange={(e) => set({ disposed_date: e.target.value })} />

        <div className="md:col-span-2 border-t border-line pt-3">
          <h4 className="text-sm font-bold mb-1">יתרת פתיחה מטופס 1342</h4>
          <p className="text-xs text-faint mb-2">
            פחת שנצבר כפי שהוא מופיע בטופס האחרון, ושנת המס שהוא נכון לסופה. משאירים ריק לנכס
            שנרכש אחרי הטופס האחרון — אז הפחת מחושב מתאריך הרכישה.
          </p>
        </div>
        <Input label="פחת שנצבר" type="number" min="0" step="0.01" dir="ltr" value={form.opening_accumulated}
          onChange={(e) => set({ opening_accumulated: e.target.value })} />
        <Input label="נכון לסוף שנת" type="number" min="1900" max="2200" dir="ltr" value={form.opening_year}
          onChange={(e) => set({ opening_year: e.target.value })} />

        <div className="md:col-span-2">
          <Switch
            checked={!!form.deducted_in_books} onChange={(v) => set({ deducted_in_books: v })}
            label="הרכישה נוכתה כהוצאה בספרים — הדוח השנתי מחזיר אותה ומפחית במקומה"
          />
        </div>
        <div className="md:col-span-2">
          <Input label="הערות" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <Button onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </div>
    </Modal>
  );
}
