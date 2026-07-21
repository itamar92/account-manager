// Payables Reminder (ספקים) — n8n Workflow SDK source
// Workflow ID in n8n: VwXrCOcTpz67Awmf
//
// Groups unpaid band suppliers BY PERSON (name), resolved from the "Google Events"
// tab, with a total owed per person + per-show breakdown (שוטף+30 due dates), and
// merges the manual ספקים לתשלום tab. Telegram to 5564386206. Read-only, never pays.
//
// This file is the source of truth for the workflow. It was validated locally but
// deployment to n8n was pending while the n8n connector's OAuth sign-in server was
// temporarily unavailable — re-run validate_workflow + update_workflow to deploy.
//
// Key mappings discovered from the Moonlight 2026 sheet:
//   Expenses tab "הוצאות לפי אירוע": headers on ROW 2, data ROW 3. Each supplier is a
//     checkbox column + amount column (before VAT). Unpaid = checkbox not TRUE.
//     Jobs: זמר, תאורן, סאונדמן, חברת הגברה, חברת צמידים.
//   Events tab "Google Events": headers on ROW 2, data ROW 3. Per show (by Date), the
//     PERSON for each job: columns סולן, תאורן, סאונדמן, חברת הגברה. Note סולן = זמר.
//     חברת צמידים has no name column → stays as the job label.
//   Due date = שוטף+30 = last day of the show's month + 30 days.
//   Verified: per-person totals sum to ₪33,000 (= the סיכום מקוצר rollup):
//     ניב פלכטמן (תאורן) 4,800 · אורן סודרי (סאונדמן) 3,600 · שרון זכרי (סאונדמן) 2,500 ·
//     סהר טוויטו (זמר) 6,000 · מייקל רוז (זמר) 2,000 · א.ד סאונד (הגברה) 6,000 · חברת צמידים 8,100.

import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const MOONLIGHT_DOC = { __rl: true, mode: 'id', value: '18kp7-kCJwQ4E6pqaMiXhY0dhsqMc2Nr5moNu_02XsL0', cachedResultName: 'הוצאות/הכנסות Moonlight 2026' };
const EXPENSES_DOC = { __rl: true, mode: 'id', value: '1tBVUqPIuZTA-v3YhiNIf0pGJ0i93OrxTNbKJBCxHTn4', cachedResultName: '2025 פירוט הוצאות עסק' };

const CODE =
  "const SUP={'זמר':'chekbox singer','תאורן':'chekbox lightman','סאונדמן':'chekbox soundman','חברת הגברה':'chekbox soundCompany','חברת צמידים':'chekbox braclet'};\n" +
  "const J2E={'זמר':'סולן','תאורן':'תאורן','סאונדמן':'סאונדמן','חברת הגברה':'חברת הגברה'};\n" +
  "function parseNIS(v){if(v===undefined||v===null||v==='')return 0;const n=parseFloat(String(v).replace(/[^0-9.-]/g,''));return isNaN(n)?0:n;}\n" +
  "function isPaid(v){if(v===true)return true;const s=String(v).trim().toUpperCase();return s==='TRUE'||s==='כן'||s==='V';}\n" +
  "function dkey(v){if(v==null||v==='')return null;const s0=String(v).trim();if(/^\\d+(\\.\\d+)?$/.test(s0)){const d=new Date(Date.UTC(1899,11,30)+Math.round(parseFloat(s0))*864e5);return d.toISOString().slice(0,10);}let m=s0.match(/(\\d{1,2})[\\/.](\\d{1,2})[\\/.](\\d{4})/);if(m)return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');m=s0.match(/(\\d{4})-(\\d{1,2})-(\\d{1,2})/);if(m)return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');const d=new Date(s0);return isNaN(d)?null:d.toISOString().slice(0,10);}\n" +
  "function showDate(ev){const m=String(ev).match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);return m?new Date(+m[3],+m[2]-1,+m[1]):null;}\n" +
  "function dueFromShow(sd){const eom=new Date(sd.getFullYear(),sd.getMonth()+1,0);return new Date(eom.getTime()+30*864e5);}\n" +
  "function parseAny(s){if(!s)return null;s=String(s).trim();let m=s.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return isNaN(d)?null:d;}\n" +
  "function fmt(d){if(!d)return 'ללא תאריך';const p=n=>String(n).padStart(2,'0');return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();}\n" +
  "const today=new Date();today.setHours(0,0,0,0);\n" +
  "const evmap={};for(const r of $('Read Events').all().map(i=>i.json)){const k=dkey(r['Date']);if(!k)continue;evmap[k]=evmap[k]||{};for(const c of ['סולן','תאורן','סאונדמן','חברת הגברה']){const nm=r[c];if(nm&&String(nm).trim())evmap[k][c]=String(nm).trim();}}\n" +
  "const groups={};function add(person,job,ctx,amt,due){const key=person+'§'+job;if(!groups[key])groups[key]={person,job,total:0,lines:[]};groups[key].total+=amt;groups[key].lines.push({ctx,amt,due});}\n" +
  "for(const r of $('Read Band Events').all().map(i=>i.json)){const ev=r['אירוע'];if(!ev||!String(ev).trim())continue;const sd=showDate(ev);if(!sd)continue;const due=dueFromShow(sd);const k=dkey(ev);const evName=String(ev).split(' - ')[0];for(const job of Object.keys(SUP)){const amt=parseNIS(r[job]);if(amt<=0)continue;if(isPaid(r[SUP[job]]))continue;const col=J2E[job];const name=(col&&evmap[k]&&evmap[k][col])?evmap[k][col]:null;add(name||job,job,evName,amt,due);}}\n" +
  "for(const r of $('Read Manual Payables').all().map(i=>i.json)){if(!r['ספק']||!String(r['ספק']).trim())continue;const st=String(r['סטטוס']||'').trim();if(st==='שולם'||st==='paid')continue;const amt=parseNIS(r['סכום']);if(amt<=0)continue;add(String(r['ספק']).trim(),r['תיאור']||'',r['תיאור']||'',amt,parseAny(r['תאריך לתשלום']));}\n" +
  "const arr=Object.values(groups);function minDue(g){let m=null;for(const l of g.lines){if(l.due&&(m===null||l.due<m))m=l.due;}return m;}\n" +
  "arr.sort((a,b)=>{const da=minDue(a),db=minDue(b);return (da?da:8e15)-(db?db:8e15);});\n" +
  "let grand=0;for(const g of arr)grand+=g.total;\n" +
  "const nis=n=>'₪'+Math.round(n).toLocaleString();function mark(due){if(!due)return '🔜';const days=Math.round((due-today)/864e5);if(days<0)return '⚠️';if(days<=7)return '🔴';if(days<=30)return '📅';return '🔜';}\n" +
  "let msg='📋 <b>ספקים לתשלום — לפי אדם</b>\\n<i>(שוטף+30 מתאריך המופע · לפני מע\\u0022מ)</i>\\n\\n';\n" +
  "if(!arr.length){msg+='✅ אין ספקים פתוחים לתשלום.\\n\\n';}\n" +
  "for(const g of arr){g.lines.sort((a,b)=>(a.due?a.due:8e15)-(b.due?b.due:8e15));msg+='<b>'+g.person+'</b>'+(g.job?' — '+g.job:'')+' · סה\\u0022כ '+nis(g.total)+'\\n';for(const l of g.lines){msg+='  '+mark(l.due)+' '+(l.ctx||'')+' — '+nis(l.amt)+' · עד '+fmt(l.due)+'\\n';}msg+='\\n';}\n" +
  "msg+='💰 סה\\u0022כ פתוח: '+nis(grand)+' לפני מע\\u0022מ ('+arr.length+' אנשים)\\n<i>תזכורת בלבד — לא מבצעת תשלומים. לסימון ששולם: סמן ✓ ליד המקצוע בגיליון.</i>';\n" +
  "return [{ json: { message: msg, people: arr.length, total: grand } }];";

const weeklyTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: { name: 'Sundays 08:30', parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [0], triggerAtHour: 8, triggerAtMinute: 30 }] } }, position: [220, 240] },
  output: [{}]
});

const manualTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Now', position: [220, 460] },
  output: [{}]
});

const readBand = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Band Events',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: MOONLIGHT_DOC,
      sheetName: { __rl: true, mode: 'name', value: 'הוצאות לפי אירוע' },
      options: { dataLocationOnSheet: { values: { rangeDefinition: 'specifyRange', headerRow: 2, firstDataRow: 3 } } }
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
    position: [440, 320]
  },
  output: [{ 'אירוע': 'זאפה חיפה - 17/06/2026', 'זמר': 2000, 'chekbox singer': false }]
});

const readManual = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Manual Payables',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: EXPENSES_DOC, sheetName: { __rl: true, mode: 'name', value: 'ספקים לתשלום' } },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
    position: [640, 320]
  },
  output: [{ 'ספק': 'ספק כללי', 'סכום': 500, 'תאריך לתשלום': '2026-08-30', 'סטטוס': 'לתשלום' }]
});

const readEvents = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Events',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: MOONLIGHT_DOC,
      sheetName: { __rl: true, mode: 'name', value: 'Google Events' },
      options: { dataLocationOnSheet: { values: { rangeDefinition: 'specifyRange', headerRow: 2, firstDataRow: 3 } } }
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
    position: [840, 320]
  },
  output: [{ 'Date': '17/06/2026', 'Name': 'זאפה חיפה', 'סולן': 'מייקל רוז', 'תאורן': 'ניב פלכטמן', 'סאונדמן': 'אורן סודרי', 'חברת הגברה': '' }]
});

const buildChecklist = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Payables Checklist', executeOnce: true, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CODE }, position: [1060, 320] },
  output: [{ message: '📋 ...', people: 7, total: 33000 }]
});

const sendTelegram = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Telegram Checklist',
    parameters: { resource: 'message', operation: 'sendMessage', chatId: '5564386206', text: expr('{{ $json.message }}'), additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    credentials: { telegramApi: newCredential('Telegram') },
    position: [1280, 320]
  },
  output: [{ ok: true }]
});

const wfNote = sticky('## Payables Reminder (ספקים) — grouped by person\nWeekly Sunday 08:30 (+ Run Now). Band suppliers from "הוצאות לפי אירוע" (unpaid = checkbox not TRUE, due שוטף+30 from show date) are resolved to a NAME via the "Google Events" tab (job→name per show; סולן=זמר). Grouped by person with a total per person and per-show breakdown. Also merges the manual ספקים לתשלום tab. Telegram to you. Never pays.', [weeklyTrigger, readBand, readEvents, buildChecklist]);

export default workflow('payables-reminder', 'Payables Reminder (ספקים)')
  .add(wfNote)
  .add(weeklyTrigger)
  .to(readBand)
  .to(readManual)
  .to(readEvents)
  .to(buildChecklist)
  .to(sendTelegram)
  .add(manualTrigger)
  .to(readBand);
