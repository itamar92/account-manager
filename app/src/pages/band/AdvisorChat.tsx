import React, { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Button, Empty, Textarea } from '../../ui';
import { eventLabel, type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { when, Working, type AdvisorJob } from './advisorShared';

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
export function AdvisorChat({ messages, events, isOwner, question, onQuestionChange, onSend, job, agentBusy, members, taskShow, onTasksAdded, onError }: {
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
  onError: (message: string) => void;
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
      <p className="text-xs text-faint mb-3">
        לסוכן יש את אותם נתונים שבלשונית «פרסום» לתקופה שנבחרה למעלה.
      </p>

      {messages.length === 0 && !waiting ? (
        <Empty text="אין עדיין שאלות" />
      ) : (
        <div ref={thread} className="flex flex-col gap-2 max-h-[32rem] overflow-y-auto">
          {messages.map((message: any) => (
            <div key={message.id} className={bubble(message.role)}>
              <div className="text-xs text-faint mb-1">
                {message.role === 'user' ? 'אתם' : 'הסוכן'} · {when(message.created_at)}
              </div>
              <p className="whitespace-pre-wrap text-ink">{message.content}</p>
              {message.tasks?.length > 0 && (
                <div className="border-t border-line mt-2 pt-2 space-y-3">
                  <div className="text-faint text-xs">משימות שהסוכן מציע — כל משימה מסומנת תישלח כתזכורת במייל ביום היעד</div>
                  {groupByShow(message.tasks).map(([eventId, tasks]) => (
                    <TaskPicker key={eventId} eventId={eventId} tasks={tasks} sourceId={message.id}
                      label={eventById(eventId) ? eventLabel(eventById(eventId)) : undefined}
                      show={taskShow(eventId)} members={members} isOwner={isOwner}
                      onAdded={onTasksAdded} onError={onError} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {waiting && job?.message && (
            <div className={bubble('user')}>
              <div className="text-xs text-faint mb-1">אתם · {when(job.started_at)}</div>
              <p className="whitespace-pre-wrap text-ink">{job.message}</p>
            </div>
          )}
          {waiting && (
            <div className={bubble('assistant')}>
              <Working text="הסוכן חושב" since={job?.started_at} />
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
            <span className="text-xs text-faint">
              {agentBusy && !waiting ? 'הסוכן עסוק בבקשה אחרת — אפשר לשלוח כשיסיים' : <span className="hidden sm:inline">Ctrl+Enter לשליחה</span>}
            </span>
            <Button onClick={onSend} disabled={!question.trim() || agentBusy}>שליחה</Button>
          </div>
        </div>
      )}
    </div>
  );
}
