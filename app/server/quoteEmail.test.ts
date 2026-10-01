import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteEmailHtml, splitMessage } from '../src/quotes/quoteEmail.js';
import type { EmailCard } from '../src/pages/moonlight/quotes.js';

const LINK = 'https://im-tools.org/q/abcdefghijklmnopqrstuvwxyz0123456789';

const CARD: EmailCard = {
  brand_name: 'Moonlight',
  logo_url: 'https://im-tools.org/api/public/quotes/abc/branding/logo?v=1',
  logo_position: 'center',
  color_primary: '#241d3d',
  color_accent: '#6b45d6',
  title: 'הופעה בחתונה',
  quote_number: 'ML-2026-003',
  event_date: '22/10/2026',
  event_location: 'קיסריה',
  total: 30680,
  vat_percent: 18,
  valid_until: '16/10/2026',
  contact_name: 'איתמר',
  contact_phone: '050-1234567',
};

test('the line the link is on becomes the button, worded as that line was', () => {
  const split = splitMessage(`שלום דנה,\nלצפייה ולאישור בחתימה: ${LINK}\nתודה`, LINK);
  assert.deepEqual(split, { before: ['שלום דנה,'], label: 'לצפייה ולאישור בחתימה', after: ['תודה'] });
});

test('a link alone on its line, a long sentence around it, or no link at all still give a button', () => {
  assert.equal(splitMessage(`שלום\n${LINK}`, LINK).label, 'לצפייה בהצעה ולחתימה');
  const long = splitMessage(`כאן אפשר לקרוא את כל ההצעה, לשאול אותנו כל שאלה ולחתום בסוף: ${LINK}`, LINK);
  assert.equal(long.label, 'לצפייה בהצעה ולחתימה');
  assert.deepEqual(long.before, ['כאן אפשר לקרוא את כל ההצעה, לשאול אותנו כל שאלה ולחתום בסוף']);
  assert.deepEqual(splitMessage('שלום', LINK), { before: ['שלום'], label: 'לצפייה בהצעה ולחתימה', after: [] });
});

test('the email carries the band, the offer and one way to the quote', () => {
  const html = quoteEmailHtml({ card: CARD, message: `שלום דנה,\nלצפייה: ${LINK}`, link: LINK });
  assert.ok(html.includes(`src="${CARD.logo_url!.replace('&', '&amp;')}"`));
  assert.ok(html.includes('align="center"'));
  assert.ok(html.includes('ML-2026-003'));
  assert.ok(html.includes('קיסריה'));
  assert.match(html, /30,680/);
  assert.ok(html.includes(`href="${LINK}"`));
  assert.ok(html.includes('>לצפייה<'));
  assert.ok(!/<script|<style|class=/.test(html), 'mail clients get inline styles only');
});

test('nothing anyone typed is read as markup, and only a web address becomes a link', () => {
  const html = quoteEmailHtml({
    card: { ...CARD, title: '<img src=x onerror=alert(1)>', logo_url: 'javascript:alert(1)', brand_name: 'A & B' },
    message: 'שלום <b>דנה</b>',
    link: 'javascript:alert(1)',
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('שלום &lt;b&gt;דנה&lt;/b&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('A &amp; B'));
});
