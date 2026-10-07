import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file the moment it is imported, so the directory is set first and the modules
// are loaded after it — a static import would be hoisted above this line and open the real one.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-advisor-test-'));
const { db } = await import('./db.js');
const advisor = await import('./campaignAdvisor.js');

test('a chat answer keeps only tasks with a real show, a title and a date', () => {
  const shows = new Set(['zappa', 'barby']);
  const tasks = advisor.cleanChatTasks([
    { event_id: 'zappa', title: ' להעלות תקציב ', detail: 'ל-120 ₪', due_date: '2026-10-28' },
    { event_id: 'made-up', title: 'הופעה שלא קיימת', due_date: '2026-10-28' },
    { event_id: 'barby', title: '', due_date: '2026-10-28' },
    { event_id: 'barby', title: 'בלי תאריך' },
    { event_id: 'barby', title: 'תאריך לא תקין', due_date: '2026-13-45' },
    { event_id: 'barby', title: 'לבדוק מכירות', due_date: '2026-11-10' },
  ], shows);
  assert.deepEqual(tasks, [
    { event_id: 'zappa', title: 'להעלות תקציב', detail: 'ל-120 ₪', due_date: '2026-10-28' },
    { event_id: 'barby', title: 'לבדוק מכירות', detail: '', due_date: '2026-11-10' },
  ]);
  assert.deepEqual(advisor.cleanChatTasks(undefined, shows), []);
  assert.deepEqual(advisor.cleanChatTasks('not a list', shows), []);
});

test('chat history hands back each answer with the tasks it proposed', () => {
  const tasks = [{ event_id: 'zappa', title: 'לבדוק', detail: '', due_date: '2026-10-14' }];
  const insert = db.prepare('INSERT INTO ai_chat_messages (id, thread_id, role, content, tasks) VALUES (?, ?, ?, ?, ?)');
  insert.run('q', 't', 'user', 'מה לעשות עכשיו?', null);
  insert.run('a', 't', 'assistant', 'הוספתי משימה.', JSON.stringify(tasks));
  insert.run('broken', 't', 'assistant', 'שורה פגומה', '{not json');

  const history = advisor.chatHistory('t');
  assert.deepEqual(history.map((m) => m.tasks), [[], tasks, []]);
});

test('every prompt carries the band brief, the judging method, the task and the data — in that order', () => {
  const prompt = advisor.buildPrompt('המשימה', '{"schema":1}', { shows: [{ label: 'זאפה' }] });
  const at = (needle: string) => {
    const index = prompt.indexOf(needle);
    assert.ok(index >= 0, `missing: ${needle}`);
    return index;
  };
  assert.ok(at('יועץ פרסום דיגיטלי') < at(advisor.ADVISOR_METHOD));
  assert.ok(at(advisor.ADVISOR_METHOD) < at('המשימה'));
  assert.ok(at('המשימה') < at('"label":"זאפה"'));
  // The method is what stops the agent inventing a ROAS the data cannot support.
  assert.match(advisor.ADVISOR_METHOD, /אל תחשב ROAS/);
  assert.equal(prompt.split(advisor.ADVISOR_METHOD).length - 1, 1);
});

test('a recommendation keeps only links to findings that exist', () => {
  const data = advisor.normaliseAnalysis({
    findings: [{ title: 'א' }, { title: 'ב' }],
    suggestions: [
      { title: 'מקשרת', addresses: [1, 1, 0] },
      { title: 'מחוץ לטווח', addresses: [2, -1, 0.5, '0'] },
      { title: 'בלי קישור' },
    ],
  });
  assert.deepEqual(data.suggestions.map((s: any) => s.addresses), [[1, 0], [], []]);
  // A report without suggestions is handed back as it came.
  assert.deepEqual(advisor.normaliseAnalysis({ verdict: 'ok' }), { verdict: 'ok' });
});

test('saved plans: the newest per show, soonest show first, with the brief they were asked with', () => {
  db.prepare('INSERT INTO band_events (id, venue, date) VALUES (?, ?, ?)').run('soon', 'בארבי', '2099-01-10');
  db.prepare('INSERT INTO band_events (id, venue, date) VALUES (?, ?, ?)').run('later', 'זאפה', '2099-03-01');
  db.prepare('INSERT INTO band_events (id, venue, date) VALUES (?, ?, ?)').run('long-ago', 'האנגר', '2001-01-01');
  const insert = db.prepare(
    `INSERT INTO ai_campaign_reports (id, kind, event_id, request, response, created_at) VALUES (?, 'draft', ?, ?, ?, ?)`
  );
  const plan = (headline: string) => JSON.stringify({ creative: { headline, headline_options: [headline, 'אחרת'] } });
  insert.run('later-1', 'later', '{}', plan('ישנה'), '2098-01-01 10:00:00');
  insert.run('soon-1', 'soon', JSON.stringify({ event_id: 'soon', brief: 'עד 800 ₪' }), plan('בארבי'), '2098-01-02 10:00:00');
  insert.run('later-2', 'later', '{}', plan('חדשה'), '2098-01-03 10:00:00');
  insert.run('gone', 'long-ago', '{}', plan('עבר'), '2098-01-04 10:00:00');

  assert.deepEqual(advisor.savedDrafts().map((d) => [d.event_id, d.report_id]), [['soon', 'soon-1'], ['later', 'later-2']]);
  assert.equal(advisor.lastReport('draft', {}, 'soon')?.request.brief, 'עד 800 ₪');
});

test('a chosen headline is kept on the plan, and only one the agent offered', () => {
  const chosen = advisor.chooseDraftCreative('soon-1', 'headline', 'אחרת');
  assert.equal(chosen.response.creative.headline, 'אחרת');
  assert.equal(advisor.lastReport('draft', {}, 'soon')?.response.creative.headline, 'אחרת');
  assert.throws(() => advisor.chooseDraftCreative('soon-1', 'headline', 'מילים שלא הוצעו'), { status: 400 });
  assert.throws(() => advisor.chooseDraftCreative('soon-1', 'primary_text', 'אחרת'), { status: 400 });
  assert.throws(() => advisor.chooseDraftCreative('missing', 'headline', 'אחרת'), { status: 404 });
});

test('a run is listed while it works, refused twice, and its failure kept until dismissed', async () => {
  let finish!: (value: string) => void;
  const running = advisor.trackJob('draft', { event_id: 'soon', brief: '' }, () => new Promise<string>((r) => { finish = r; }));
  assert.deepEqual(advisor.listJobs().map((j) => [j.kind, j.status, j.event_id]), [['draft', 'running', 'soon']]);
  await assert.rejects(advisor.trackJob('draft', {}, async () => 'again'), { status: 409 });

  finish('done');
  assert.equal(await running, 'done');
  assert.deepEqual(advisor.listJobs(), []);

  await assert.rejects(advisor.trackJob('chat', { message: 'למה?' }, async () => { throw new Error('נפל'); }), /נפל/);
  assert.deepEqual(advisor.listJobs().map((j) => [j.kind, j.status, j.error]), [['chat', 'failed', 'נפל']]);
  advisor.dismissJob('chat');
  assert.deepEqual(advisor.listJobs(), []);
});
