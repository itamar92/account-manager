import React, { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Button, Textarea } from '../../ui';
import { eventLabel, type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { InlineError, OverflowMenu, when, Working, type AdvisorJob } from './advisorShared';
import { ActionButtons } from './MetaActions';

/** A chat answer's tasks, one group per show, in the order the shows first appear. */
function groupByShow(tasks: any[]): Array<[string, any[]]> {
  const groups = new Map<string, any[]>();
  for (const task of tasks) groups.set(task.event_id, [...(groups.get(task.event_id) ?? []), task]);
  return [...groups];
}

/**
 * שאלות המשך — the «why was that show so expensive?» box.
 *
 * A question waiting for its answer is shown in the thread straight away, and stays there across a
 * reload: the server only writes the pair once the answer arrives, so until then it comes from the
 * run in progress.
 */
export function AdvisorChat({ messages, events, isOwner, question, onQuestionChange, onSend, job, agentBusy, members, taskShow, onTasksAdded, onActionDone, onError, failure, onDismissFailure, periodLabel, onClear }: {
  messages: any[];
  events: any[];
  isOwner: boolean;
  question: string;
  onQuestionChange: (text: string) => void;
  onSend: () => void;
  job?: AdvisorJob;
  /** The agent is answering something else; it takes one request at a time. */
  agentBusy: boolean;
  members: BandMember[];
  taskShow: (eventId: string) => any;
  onTasksAdded: () => void;
  onActionDone: () => void;
  onError: (message: string) => void;
  /** Why the last question went unanswered, said under the box it was typed in. */
  failure?: string;
  onDismissFailure: () => void;
  /** The period the agent reads, as the period summary has it chosen. */
  periodLabel: string;
  onClear: () => void;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const waiting = job?.status === 'running';
  const eventById = (id: string) => events.find((e) => e.id === id);

  // Scrolls the thread, not the page: opening the tab should not drag the reader to the bottom.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, waiting]);

  const bubble = (role: string) => clsx(
    'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[92%] sm:max-w-[80%]',
    role === 'user' ? 'ms-auto bg-accent-soft border border-accent/20' : 'me-auto bg-soft border border-line'
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-muted">הסוכן עונה לפי נתוני הקמפיינים של {periodLabel}.</p>
        {isOwner && messages.length > 0 && !waiting && (
          <OverflowMenu label="עוד פעולות על השיחה" items={[{ label: 'מחיקת השיחה', onSelect: onClear, danger: true }]} />
        )}
      </div>

      {messages.length === 0 && !waiting ? (
        <p className="text-sm text-body py-2">
          {isOwner ? 'עוד לא נשאלו שאלות. אפשר לשאול כל דבר על הקמפיינים, והתשובה נשמרת כאן.' : 'עוד לא נשאלו שאלות.'}
        </p>
      ) : (
        <div ref={thread} className="flex flex-col gap-2 max-h-[32rem] overflow-y-auto">
          {messages.map((message: any) => (
            <div key={message.id} className={bubble(message.role)}>
              <div className="text-xs text-muted mb-1">
                {message.role === 'user' ? 'אתם' : 'הסוכן'} · {when(message.created_at)}
              </div>
              <p className="whitespace-pre-wrap text-ink">{message.content}</p>
              {message.tasks?.length > 0 && (
                <div className="border-t border-line mt-2 pt-2 space-y-3">
                  <div className="text-muted text-xs">משימות שהסוכן מציע. כל משימה מסומנת נשלחת כתזכורת במייל ביום היעד.</div>
                  {groupByShow(message.tasks).map(([eventId, tasks]) => (
                    <TaskPicker key={eventId} eventId={eventId} tasks={tasks} sourceId={message.id}
                      label={eventById(eventId) ? eventLabel(eventById(eventId)) : undefined}
                      show={taskShow(eventId)} members={members} isOwner={isOwner}
                      onAdded={onTasksAdded} onError={onError} />
                  ))}
                </div>
              )}
              {message.actions?.length > 0 && (
                <div className="border-t border-line mt-2 pt-2">
                  <ActionButtons actions={message.actions} source="chat" sourceId={message.id}
                    isOwner={isOwner} onError={onError} onDone={onActionDone} />
                </div>
              )}
            </div>
          ))}
          {waiting && job?.message && (
            <div className={bubble('user')}>
              <div className="text-xs text-muted mb-1">אתם · {when(job.started_at)}</div>
              <p className="whitespace-pre-wrap text-ink">{job.message}</p>
            </div>
          )}
          {waiting && (
            <div className={bubble('assistant')}>
              <Working text="הסוכן חושב" since={job?.started_at} hint={false} />
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={question}
            rows={2}
            disabled={waiting}
            placeholder="למשל: למה הקמפיין של ההופעה בבארבי היה יקר פי שניים?"
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.trim() && !agentBusy) onSend();
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {agentBusy && !waiting ? 'הסוכן עסוק בבקשה אחרת. אפשר לשלוח כשיסיים.' : <span className="hidden sm:inline">Ctrl+Enter לשליחה</span>}
            </span>
            <Button onClick={onSend} disabled={!question.trim() || agentBusy}>שליחה</Button>
          </div>
          <InlineError text={failure} onDismiss={onDismissFailure} />
        </div>
      )}
    </div>
  );
}
