import React, { useState } from 'react';
import { del, post, put } from '../../api';
import { Button, Input } from '../../ui';
import { useExpenseCategories, type ExpenseCategory } from './shared';

/**
 * The cost lines a show carries, and what the band calls each of them.
 *
 * The app ships with twelve — lighting, sound, singer, PA company, hall, wristbands, royalties,
 * campaign, refreshments, design, other, extra — and they were columns in the source. They are
 * rows now: a band that pays a roadie, rents a van or buys merch adds a line here and every
 * show page lists it from then on. A line can be renamed, switched off, or marked as one that
 * is settled separately after the show (so it carries an open/paid state). A line the band
 * added can be deleted while no show holds an amount on it; the built-in ones can only be
 * switched off, since existing shows may carry money on them.
 *
 * Every line is also a supplier role in waiting (סוגי ספקים below): switching the role on is
 * how the band says it hires somebody for that line.
 */
export function ExpenseCategoriesPanel({ isOwner, onError, onChange }: {
  isOwner: boolean;
  onError: (message: string) => void;
  onChange: () => void;
}) {
  const { categories, reload } = useExpenseCategories();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [newName, setNewName] = useState('');
  const [newSettles, setNewSettles] = useState(true);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    onError('');
    try {
      await action();
      reload();
      onChange();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const save = (category: ExpenseCategory, patch: Partial<ExpenseCategory> & { name?: string }) =>
    run(category.key, () => put(`/band/expense-categories/${category.key}`, patch));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await run('new', () => post('/band/expense-categories', { name: newName.trim(), settles: newSettles ? 1 : 0 }));
    setNewName('');
  };

  const remove = (category: ExpenseCategory) => {
    if (!confirm(`למחוק את שורת העלות «${category.name}»?`)) return;
    run(category.key, () => del(`/band/expense-categories/${category.key}`));
  };

  const active = categories.filter((c) => c.active);
  const off = categories.filter((c) => !c.active);

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="ser text-lg">שורות עלות בהופעה</h3>
          <p className="text-[13px] text-muted">
            {active.map((c) => c.name).join(' · ') || 'לא הוגדרו שורות'}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? 'סגירה' : 'ניהול השורות'}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 pt-1">
          <p className="text-[13px] text-muted">
            כל הופעה נושאת את השורות האלה — אלה ההוצאות שמהן נגזר הרווח. שורה «משולמת בנפרד» היא
            כסף שמישהו מקבל אחרי ההופעה, ולכן יש לה מצב פתוח/שולם; שורה אחרת נסגרת ברגע שמקלידים
            אותה (תשלום בכרטיס). כיבוי שורה מסתיר אותה מהופעות שאין בהן סכום ואינו נוגע בהופעות
            שכבר נושאות אחד.
          </p>

          <div className="space-y-1.5">
            {categories.map((category) => {
              const editing = draft[category.key] !== undefined;
              return (
                <div
                  key={category.key}
                  className="flex items-center gap-2 flex-wrap border-b border-line pb-2 last:border-0"
                >
                  <div className="min-w-[11rem] flex-1">
                    {editing ? (
                      <Input
                        value={draft[category.key]}
                        autoFocus
                        onChange={(e) => setDraft({ ...draft, [category.key]: e.target.value })}
                      />
                    ) : (
                      <>
                        <span className={category.active ? 'font-medium' : 'text-muted'}>{category.name}</span>
                        <span className="text-[12px] text-faint block">
                          {category.shows ? `${category.shows} הופעות עם סכום` : 'אין הופעות עם סכום'}
                          {category.builtin ? ' · מובנית' : ''}
                        </span>
                      </>
                    )}
                  </div>

                  {isOwner && (
                    <div className="flex items-center gap-3 text-sm">
                      {editing ? (
                        <>
                          <button
                            className="text-accent hover:underline"
                            disabled={busy === category.key}
                            onClick={() => {
                              const name = draft[category.key];
                              const next = { ...draft };
                              delete next[category.key];
                              setDraft(next);
                              save(category, { name });
                            }}
                          >
                            שמירה
                          </button>
                          <button
                            className="text-muted hover:underline"
                            onClick={() => {
                              const next = { ...draft };
                              delete next[category.key];
                              setDraft(next);
                            }}
                          >
                            ביטול
                          </button>
                        </>
                      ) : (
                        <button
                          className="text-accent hover:underline"
                          onClick={() => setDraft({ ...draft, [category.key]: category.name })}
                        >
                          שינוי שם
                        </button>
                      )}

                      <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                        <input
                          type="checkbox"
                          className="accent-accent"
                          checked={!!category.settles}
                          disabled={!category.active}
                          onChange={(e) => save(category, { settles: e.target.checked ? 1 : 0 })}
                        />
                        משולמת בנפרד
                      </label>

                      <button
                        className={category.active ? 'text-neg hover:underline' : 'text-pos hover:underline'}
                        disabled={busy === category.key}
                        onClick={() => save(category, { active: category.active ? 0 : 1 })}
                      >
                        {category.active ? 'כיבוי' : 'הפעלה'}
                      </button>

                      {!category.builtin && !category.shows && !category.suppliers && (
                        <button
                          className="text-neg hover:underline"
                          disabled={busy === category.key}
                          onClick={() => remove(category)}
                        >
                          מחיקה
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isOwner && (
            <form onSubmit={add} className="flex items-end gap-2 flex-wrap pt-1">
              <div className="min-w-[12rem] flex-1">
                <Input label="שורה חדשה" value={newName} placeholder="לדוגמה: הסעות"
                  onChange={(e) => setNewName(e.target.value)} />
              </div>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2 pb-2.5">
                <input type="checkbox" className="accent-accent" checked={newSettles}
                  onChange={(e) => setNewSettles(e.target.checked)} />
                משולמת בנפרד
              </label>
              <Button type="submit" variant="ghost" disabled={busy === 'new' || !newName.trim()}>+ הוספה</Button>
            </form>
          )}

          {off.length > 0 && (
            <p className="text-[12px] text-faint">
              שורות כבויות ({off.map((c) => c.name).join(', ')}) עדיין מוצגות בהופעות שנושאות בהן סכום,
              והסכום הזה ממשיך להיספר בהוצאות ההופעה.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
