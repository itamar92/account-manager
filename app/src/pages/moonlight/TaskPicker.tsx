import React, { useEffect, useState } from 'react';
import { post, put } from '../../api';
import { Button } from '../../ui';
import { israelToday } from './CampaignTasksPanel';
import type { BandMember } from './shared';

export interface ProposedTask {
  title: string;
  detail?: string;
  due_date: string;
}

interface Props {
  eventId: string;
  /** Shown above the list when the proposals belong to a show the reader has not chosen. */
  label?: string;
  tasks: ProposedTask[];
  /** The draft report or chat message the tasks came from — how «already added» is recognised. */
  sourceId: string;
  /** The show as the tasks list has it: its owner, and the tasks it already has. */
  show?: { owner: string | null; tasks: Array<{ report_id: string | null }> } | null;
  members: BandMember[];
  isOwner: boolean;
  onAdded: () => void;
  onError: (message: string) => void;
}

/**
 * Tasks the advisor proposed for one show, as a checklist to accept.
 *
 * Nothing the agent says takes effect on its own: the ticked ones become campaign tasks, with the
 * dates as edited here, only when «הוספה למשימות» is pressed. Whether that already happened is
 * read from the show's tasks rather than remembered, so a plan or an answer opened again a day
 * later says its tasks were taken instead of offering them twice.
 */
export function TaskPicker({ eventId, label, tasks, sourceId, show, members, isOwner, onAdded, onError }: Props) {
  const [picks, setPicks] = useState(() => tasks.map((t) => ({ ...t, checked: true })));
  const [owner, setOwner] = useState(show?.owner ?? '');
  const [adding, setAdding] = useState(false);

  useEffect(() => { setPicks(tasks.map((t) => ({ ...t, checked: true }))); }, [sourceId, eventId]);
  useEffect(() => { setOwner(show?.owner ?? ''); }, [show?.owner]);

  const added = !!sourceId && !!show?.tasks.some((task) => task.report_id === sourceId);
  if (!picks.length) return null;

  const update = (i: number, patch: Partial<(typeof picks)[number]>) =>
    setPicks((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const add = async () => {
    const chosen = picks.filter((p) => p.checked && p.due_date);
    if (!chosen.length) return;
    setAdding(true);
    onError('');
    try {
      await post('/moonlight/campaign-tasks', {
        event_id: eventId,
        report_id: sourceId || null,
        tasks: chosen.map(({ title, detail, due_date }) => ({ title, detail, due_date })),
      });
      if (owner && owner !== show?.owner) await put(`/moonlight/campaign-tasks/owner/${eventId}`, { member_key: owner });
      onAdded();
    } catch (err: any) { onError(err.message); }
    finally { setAdding(false); }
  };

  const locked = added || !isOwner;

  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-medium text-ink-2">{label}</div>}
      <ul className="space-y-1.5">
        {picks.map((pick, i) => (
          <li key={i} className="flex flex-wrap sm:flex-nowrap items-start gap-x-2 gap-y-1">
            <input type="checkbox" className="accent-accent mt-1 shrink-0" checked={pick.checked}
              disabled={locked} onChange={(e) => update(i, { checked: e.target.checked })} />
            {/* Wide enough that on a phone the date drops under the task rather than squeezing it. */}
            <div className="min-w-[12rem] flex-1">
              <div>{pick.title}</div>
              {pick.detail && <div className="text-xs text-muted leading-relaxed">{pick.detail}</div>}
            </div>
            <input type="date" value={pick.due_date} disabled={locked} min={israelToday()}
              className="shrink-0 ms-6 sm:ms-0 bg-surface border border-line rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent"
              onChange={(e) => update(i, { due_date: e.target.value })} />
          </li>
        ))}
      </ul>
      {added ? (
        <p className="text-xs text-pos">נוספו למשימות ✓</p>
      ) : isOwner && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">אחראי לתזכורות:</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}
            className="bg-soft border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent">
            <option value="">ללא אחראי (לא יישלחו מיילים)</option>
            {members.filter((m) => m.active).map((m) => (
              <option key={m.member_key} value={m.member_key}>
                {m.name}{m.email ? '' : ' (אין מייל)'}
              </option>
            ))}
          </select>
          <Button onClick={add} disabled={adding || !picks.some((p) => p.checked && p.due_date)}>
            {adding ? 'מוסיף…' : 'הוספה למשימות'}
          </Button>
        </div>
      )}
    </div>
  );
}
