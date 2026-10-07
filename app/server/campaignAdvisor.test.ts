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
