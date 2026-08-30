import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, nis } from '../../api';
import { Button, DataTable, PageHeader, fieldClass } from '../../ui';
import { roleName, type TabProps } from './shared';

/**
 * Where the name the band uses meets the name on the invoice.
 *
 * אבי is «אבי סאונד» in the diary and «א. כהן הפקות בע"מ» on his invoice, and no amount of
 * cleverness turns one string into the other. Said here once, every document that name has
 * ever arrived on — and every one still to come — is matched to him without anybody being
 * asked again.
 *
 * The top half is the working part: the invoice names Morning has sent that nothing answers
 * to. Those are exactly why a payment sits waiting with no suggestion under it, so they are
 * listed where they can be fixed, worth most first, each with the supplier it most resembles
 * already picked. The bottom half is the mapping itself, for reading back and correcting.
 */
export function SupplierNamesTab({ isOwner, onError }: TabProps) {
  const [payees, setPayees] = useState<any[]>([]);
  const [unknown, setUnknown] = useState<any[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    get('/moonlight/supplier-names')
      .then((d) => {
        setPayees(d.payees);
        setUnknown(d.unknown);
        // The proposal is pre-selected rather than only shown: it is right most of the time,
        // and a select that starts empty makes every row a decision from scratch.
        setChoice(Object.fromEntries(
          d.unknown.map((row: any) => [
            row.normalized,
            row.suggestion ? `${row.suggestion.kind === 'member' ? 'm' : 's'}:${row.suggestion.id}` : '',
          ])
        ));
      })
      .catch((e) => onError(e.message));
  };
  useEffect(load, []);

  const tie = async (payeeKey: string, alias: string, key: string) => {
    if (!payeeKey) return onError('בחרו למי שייך השם');
    setBusy(key);
    onError('');
    setNotice('');
    const payee = payees.find((p) => p.key === payeeKey);
    try {
      const d = await post('/moonlight/supplier-names', {
        payee_kind: payee?.kind, payee_id: payee?.id, alias,
      });
      setNotice(d.linked
        ? `«${alias}» שויך ל«${payee?.name ?? ''}» — ${d.linked} תשלומים נסגרו בעקבות זה`
        : `«${alias}» שויך ל«${payee?.name ?? ''}»`);
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const untie = async (id: string) => {
    onError('');
    setNotice('');
    try { await del(`/moonlight/supplier-names/${id}`); load(); }
    catch (err: any) { onError(err.message); }
  };

  const unknownTotal = unknown.reduce((sum, row) => sum + (Number(row.total) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="שמות בחשבוניות"
        sub="איך קוראים לו כאן, ואיך הוא חתום על החשבונית שלו"
      />

      <p className="text-[13px] text-muted">
        המערכת מזהה חשבונית לפי ח.פ/ת.ז או לפי מזהה הספק ב־Morning. כשאין אף אחד מהם — וזה המצב
        הרגיל אצל ספק קטן — נשאר רק השם, והשם על החשבונית כמעט אף פעם אינו השם שאתם קוראים לו.
        שם שנרשם כאן שקול לזיהוי ודאי: כל מסמך שיגיע בו ישויך לבד, וגם מסמכים שכבר נמצאים
        במערכת ייבדקו מחדש ברגע שתשמרו. גם חברי הלהקה כאן — מי שמוציא חשבונית על חלקו חתום
        עליה בשם העסק שלו, לא בשמו בלהקה. ראו <Link to="/moonlight/supplierPayments" className="text-accent hover:underline">תשלומים לספקים</Link>.
      </p>

      {notice && <div className="text-sm text-pos bg-pos-soft rounded-xl px-4 py-2.5">{notice}</div>}

      <div className="space-y-3">
        <h3 className="ser text-lg">
          שמות שלא זוהו
          {unknown.length > 0 && (
            <span className="text-[13px] text-muted font-normal">
              {' '}· {unknown.length} שמות · <span className="num">{nis(unknownTotal)}</span> במסמכים
            </span>
          )}
        </h3>
        <p className="text-[13px] text-muted">
          שמות שהופיעו על מסמכים מ־Morning ואינם מוכרים לאף ספק ולאף חבר. כל עוד הם כאן,
          המסמכים שלהם לא ישויכו לאף תשלום.
        </p>

        <DataTable
          empty="כל שם על המסמכים מזוהה 🎉"
          rows={unknown}
          rowKey={(row: any) => row.normalized}
          columns={[
            {
              key: 'name', header: 'השם על המסמך', mobile: 'title',
              sortValue: (row: any) => row.name,
              className: 'font-medium',
              render: (row: any) => row.name,
            },
            {
              key: 'docs', header: 'מסמכים', sortValue: (row: any) => row.docs,
              render: (row: any) => `${row.docs}`,
            },
            {
              key: 'total', header: 'סכום', className: 'whitespace-nowrap',
              sortValue: (row: any) => row.total,
              render: (row: any) => <span className="num">{nis(row.total)}</span>,
            },
            {
              key: 'last', header: 'אחרון', className: 'whitespace-nowrap',
              sortValue: (row: any) => row.last_date,
              render: (row: any) => row.last_date || '—',
            },
            isOwner && {
              key: 'tie', header: 'שייכו למי שהוציא', mobile: 'actions' as const,
              render: (row: any) => (
                <div className="flex items-center gap-2 justify-end">
                  <select
                    value={choice[row.normalized] ?? ''}
                    onChange={(e) => setChoice({ ...choice, [row.normalized]: e.target.value })}
                    className={`${fieldClass} w-44`}
                  >
                    <option value="">בחרו…</option>
                    <optgroup label="ספקים">
                      {payees.filter((p) => p.kind === 'supplier').map((p) => (
                        <option key={p.key} value={p.key}>{p.name} — {p.role_name || roleName(p.role)}</option>
                      ))}
                    </optgroup>
                    <optgroup label="חברי הלהקה">
                      {payees.filter((p) => p.kind === 'member').map((p) => (
                        <option key={p.key} value={p.key}>{p.name} — חלוקת רווח</option>
                      ))}
                    </optgroup>
                  </select>
                  <Button
                    variant="ghost"
                    disabled={busy === row.normalized}
                    onClick={() => tie(choice[row.normalized] ?? '', row.name, row.normalized)}
                  >
                    {busy === row.normalized ? 'שומר…' : 'שיוך'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        {unknown.some((row: any) => row.suggestion) && (
          <p className="text-[12px] text-faint">
            מי שנבחר מראש הוא ניחוש לפי דמיון בשם — בדקו אותו לפני השמירה.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="ser text-lg">השמות של כל מקבל תשלום</h3>
        <div className="space-y-2">
          {payees.map((supplier) => (
            <div key={supplier.key} className="border border-line rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-medium">{supplier.name}</span>
                  <span className="text-[13px] text-muted">
                    {' · '}{supplier.kind === 'member' ? 'חבר להקה' : roleName(supplier.role)}
                  </span>
                </div>
                <div className="text-[12px] text-faint">
                  {supplier.tax_id
                    ? <>ח.פ/ת.ז <span dir="ltr">{supplier.tax_id}</span> · זיהוי ודאי</>
                    : supplier.kind === 'member' && !supplier.expects_invoice
                      ? 'לא רשום — לא מצפים ממנו לחשבונית'
                      : 'אין ח.פ/ת.ז — הזיהוי נשען על השמות שכאן'}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {supplier.names.length === 0 && (
                  <span className="text-[13px] text-faint">עדיין לא נרשם שם חשבונית.</span>
                )}
                {supplier.names.map((alias: any) => (
                  <span
                    key={alias.id}
                    className="flex items-center gap-1.5 text-[13px] bg-soft rounded-full px-2.5 py-1"
                    title={alias.source === 'link' ? 'נלמד משיוך חשבונית לתשלום' : undefined}
                  >
                    {alias.alias}
                    {isOwner && (
                      <button className="text-neg leading-none" onClick={() => untie(alias.id)}>✕</button>
                    )}
                  </span>
                ))}
              </div>

              {isOwner && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = (adding[supplier.key] || '').trim();
                    if (!value) return;
                    tie(supplier.key, value, supplier.key);
                    setAdding({ ...adding, [supplier.key]: '' });
                  }}
                >
                  <input
                    className={`${fieldClass} max-w-xs`}
                    placeholder="שם נוסף שמופיע על החשבונית"
                    value={adding[supplier.key] || ''}
                    onChange={(e) => setAdding({ ...adding, [supplier.key]: e.target.value })}
                  />
                  <Button type="submit" variant="ghost" disabled={busy === supplier.key}>
                    {busy === supplier.id ? 'שומר…' : 'הוספה'}
                  </Button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
