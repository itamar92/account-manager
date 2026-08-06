import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { del, get, post, put, nis } from '../../api';
import {
  Card, Combobox, DataTable, EditableCell, Empty, PeriodSelect, SearchInput, StatCard, textMatch,
} from '../../ui';
import { eventLabel, type PeriodTabProps } from './shared';

interface Props extends PeriodTabProps {
  events: any[];
}

const pct = (value: number | null) => (value == null ? '—' : `${value}%`);

/**
 * פרסום — what each show's Meta campaign cost, and which campaign paid for which show.
 *
 * Two halves, in the order the work happens. The analysis on top answers the question the
 * integration exists for: ad spend per show against the tickets it sold and the fee it earned.
 * The campaign list below it is where a campaign is tied to a show, which is what makes the
 * analysis possible — spend nobody has mapped is counted separately rather than quietly ignored,
 * so a total can always be read against the account's real spend.
 *
 * Mapping is deliberately manual. The suggestions are ranked by the campaign's name, any date in
 * it, and when the money went out, but nothing is written until someone accepts one: a campaign
 * name is written for people, and a tour promoted by one campaign cannot be split by any rule.
 */
export function AdsTab({ events, period, isOwner, onError }: Props) {
  const [analysis, setAnalysis] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [busy, setBusy] = useState('');

  const load = () => {
    const query = period.params().toString();
    get(`/moonlight/ad-analysis${query ? `?${query}` : ''}`)
      .then(setAnalysis)
      .catch((e) => onError(e.message));
    // Campaigns are never period-filtered: a campaign for next month's show has to be mappable
    // while the table is showing this month.
    if (isOwner) {
      get('/integrations/meta/campaigns')
        .then((d) => setCampaigns(d.campaigns))
        .catch((e) => onError(e.message));
    }
  };
  useEffect(load, [period.year, period.month]);

  const mapTo = async (campaignId: string, eventId: string, weight?: number) => {
    if (!eventId) return;
    setBusy(campaignId);
    onError('');
    try {
      await post(`/integrations/meta/campaigns/${campaignId}/mappings`, { event_id: eventId, weight });
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const unmap = async (campaignId: string, eventId: string) => {
    setBusy(campaignId);
    onError('');
    try {
      await del(`/integrations/meta/campaigns/${campaignId}/mappings/${eventId}`);
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  /**
   * Hands a hand-typed קמפיין figure back to the sync. Confirmed first, because the number on
   * screen is about to be replaced by Meta's — and for a show whose profit is already divided,
   * that moves what the band is owed.
   */
  const unlock = async (expenseId: string) => {
    if (!confirm('להעביר את שורת ההוצאות לסנכרון מ-Meta? הסכום שהוזן ידנית יוחלף בסכום שהקמפיינים המשויכים מדווחים.')) return;
    onError('');
    try {
      await put(`/moonlight/event-expenses/${expenseId}`, { campaign_locked: 0 });
      load();
    } catch (err: any) { onError(err.message); }
  };

  const totals = analysis?.totals;
  const rows = (analysis?.rows ?? []).filter((r: any) => textMatch(search, r.label));
  const visibleCampaigns = unmappedOnly ? campaigns.filter((c) => c.events.length === 0) : campaigns;

  return (
    <div className="space-y-3">
      {totals && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard label="הוצאות פרסום" value={nis(totals.ad_spend)}
            sub={`${totals.shows} הופעות עם פרסום`} accent="text-rose-400" />
          <StatCard label="עלות לכרטיס" value={totals.cost_per_ticket == null ? '—' : nis(totals.cost_per_ticket)}
            sub={`${totals.tickets.toLocaleString('he-IL')} כרטיסים`} />
          <StatCard label="פרסום מתוך ההכנסה" value={pct(totals.spend_share_of_revenue)}
            sub={`מתוך ${nis(totals.revenue)}`} />
          <StatCard label="פרסום לא משויך" value={nis(totals.unmapped_spend)}
            sub={totals.unmapped_spend > 0 ? 'קמפיינים שטרם שויכו להופעה' : 'הכל משויך'}
            accent={totals.unmapped_spend > 0 ? 'text-amber-400' : 'text-emerald-400'} />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold">עלות פרסום לפי הופעה</h2>
            <PeriodSelect year={period.year} month={period.month}
              onYearChange={period.setYear} onMonthChange={period.setMonth} />
          </div>
          <p className="text-xs text-slate-500">
            הסכומים מגיעים מהשיוך לקמפיינים · «עלות לכרטיס» מחייבת מספר כרטיסים בטבלת ההכנסות
          </p>
        </div>

        <div className="mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי הופעה…" className="w-full sm:max-w-xs" />
        </div>

        {rows.length === 0 ? <Empty text="אין הופעות בטווח הזה" /> : (
          <DataTable
            rows={rows}
            rowKey={(r: any) => r.event_id}
            rowClassName={() => 'hover:bg-slate-800/40'}
            defaultSort={{ key: 'ad_spend', dir: -1 }}
            columns={[
              {
                key: 'label', header: 'הופעה', mobile: 'title', sortValue: (r: any) => r.date,
                className: 'font-medium whitespace-nowrap',
                render: (r: any) => (
                  <div>
                    <div>{r.venue}</div>
                    <div className="text-xs text-slate-500">{r.date}</div>
                  </div>
                ),
              },
              {
                key: 'tickets', header: 'כרטיסים', sortValue: (r: any) => r.tickets,
                render: (r: any) => (r.tickets ? r.tickets.toLocaleString('he-IL') : '—'),
              },
              {
                key: 'revenue', header: 'הכנסה', sortValue: (r: any) => r.revenue,
                className: 'whitespace-nowrap',
                render: (r: any) => (r.revenue ? nis(r.revenue) : '—'),
              },
              {
                key: 'ad_spend', header: 'פרסום', sortValue: (r: any) => r.ad_spend,
                className: 'whitespace-nowrap',
                render: (r: any) => (
                  <div>
                    <span className={r.ad_spend ? 'text-rose-400 font-medium' : 'text-slate-500'}>
                      {r.ad_spend ? nis(r.ad_spend) : '—'}
                    </span>
                    {r.campaigns > 0 && (
                      <div className="text-xs text-slate-500">{r.campaigns} קמפיינים</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'cost_per_ticket', header: 'עלות לכרטיס', sortValue: (r: any) => r.cost_per_ticket,
                className: 'whitespace-nowrap',
                render: (r: any) => (
                  r.cost_per_ticket == null
                    ? <span className="text-slate-500" title="אין מספר כרטיסים או אין הוצאת פרסום">—</span>
                    : <span className="font-medium">{nis(r.cost_per_ticket)}</span>
                ),
              },
              {
                key: 'share', header: 'מתוך ההכנסה', sortValue: (r: any) => r.spend_share_of_revenue,
                render: (r: any) => (
                  <span className={clsx(
                    r.spend_share_of_revenue != null && r.spend_share_of_revenue > 40 && 'text-amber-400'
                  )}>
                    {pct(r.spend_share_of_revenue)}
                  </span>
                ),
              },
              {
                key: 'clicks', header: 'קליקים', sortValue: (r: any) => r.clicks,
                render: (r: any) => (r.clicks ? r.clicks.toLocaleString('he-IL') : '—'),
              },
              {
                // The books' own figure, shown only where it disagrees with Meta's — a row
                // someone typed over is the one worth a second look, and a matching row would
                // just repeat the column beside it.
                key: 'on_row', header: 'בספרים', sortValue: (r: any) => r.campaign_on_row,
                render: (r: any) => {
                  const differs = Math.abs(r.campaign_on_row - r.ad_spend) >= 1;
                  if (!differs && !r.campaign_locked) return <span className="text-slate-600">—</span>;
                  return (
                    <div className="whitespace-nowrap">
                      <span className={differs ? 'text-amber-400' : ''}>{nis(r.campaign_on_row)}</span>
                      {r.campaign_locked && (
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <span title="הסכום הוזן ידנית — הסנכרון לא דורס אותו">🔒 ידני</span>
                          {isOwner && r.expense_id && (
                            <button onClick={() => unlock(r.expense_id)}
                              title="להעביר את השורה לסנכרון — הסכום יוחלף במה ש-Meta מדווחת"
                              className="text-indigo-400 hover:underline">
                              לסנכרון
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        )}
        <p className="text-xs text-slate-500 mt-3">
          «בספרים» מופיע רק כשהסכום בעמודת «קמפיין» בהוצאות ההופעה שונה ממה ש-Meta מדווחת. סכום
          שהוזן ידנית מסומן 🔒 והסנכרון לא דורס אותו — כולל כל הסכומים שהיו בספרים לפני חיבור
          Meta, שנשארים כפי שהם עד ש«לסנכרון» נלחץ עליהם במפורש.
        </p>
      </Card>

      {isOwner && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className="font-bold">קמפיינים ב-Meta</h2>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)}
                className="accent-indigo-500" />
              רק קמפיינים ללא שיוך
            </label>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            שיוך קמפיין להופעה נעשה ידנית. קמפיין שמשויך לכמה הופעות מתחלק ביניהן לפי «משקל» —
            1 לכולן היא חלוקה שווה. הסנכרון עצמו נמצא בהגדרות → חיבורים.
          </p>

          {visibleCampaigns.length === 0 ? (
            <Empty text={campaigns.length === 0
              ? 'לא נמשכו קמפיינים — הריצו סנכרון Meta בהגדרות → חיבורים'
              : 'כל הקמפיינים משויכים'} />
          ) : (
            <div className="space-y-2">
              {visibleCampaigns.map((campaign) => (
                <div key={campaign.id} className="bg-slate-800/40 border border-slate-800 rounded-xl p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{campaign.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {campaign.first_spend_date
                          ? `${campaign.first_spend_date} – ${campaign.last_spend_date}`
                          : 'ללא הוצאה בטווח שנמשך'}
                        {campaign.status && campaign.status !== 'ACTIVE' && ` · ${campaign.status}`}
                        {campaign.clicks > 0 && ` · ${campaign.clicks.toLocaleString('he-IL')} קליקים`}
                      </div>
                    </div>
                    <div className="text-rose-400 font-medium whitespace-nowrap">
                      {nis(campaign.spend)}
                      {campaign.currency !== 'ILS' && (
                        <div className="text-xs text-slate-500" dir="ltr">
                          {campaign.spend_original} {campaign.currency}
                        </div>
                      )}
                    </div>
                  </div>

                  {campaign.events.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {campaign.events.map((mapping: any) => (
                        <div key={mapping.event_id}
                          className="flex flex-wrap items-center gap-2 text-sm border-t border-slate-800/60 pt-1.5">
                          <span className="font-medium">{mapping.label}</span>
                          <span className="text-rose-400">{nis(mapping.attributed)}</span>
                          <span className="text-xs text-slate-500">{Math.round(mapping.share * 100)}%</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            משקל
                            <EditableCell type="number" value={mapping.weight} display={String(mapping.weight)}
                              onSave={(v) => mapTo(campaign.id, mapping.event_id, Number(v) || 1)} />
                          </span>
                          <button onClick={() => unmap(campaign.id, mapping.event_id)}
                            className="text-xs text-rose-400 hover:underline mr-auto">
                            ביטול שיוך
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {campaign.suggestions?.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">הצעות:</span>
                      {campaign.suggestions.map((s: any) => (
                        <button key={s.event_id} onClick={() => mapTo(campaign.id, s.event_id)}
                          title={s.reason}
                          className="text-xs bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded-lg px-2 py-1 hover:bg-indigo-500/20">
                          {s.label} · {Math.round(s.score * 100)}%
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 max-w-xs">
                    <Combobox
                      value=""
                      disabled={busy === campaign.id}
                      placeholder={campaign.events.length ? '+ הופעה נוספת…' : 'שיוך להופעה…'}
                      options={[
                        { value: '', label: 'שיוך להופעה…' },
                        ...events
                          .filter((e) => !campaign.events.some((m: any) => m.event_id === e.id))
                          .map((e) => ({ value: e.id, label: eventLabel(e) })),
                      ]}
                      onChange={(v) => mapTo(campaign.id, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
