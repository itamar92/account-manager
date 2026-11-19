import React, { useState } from 'react';
import { put } from '../../api';
import { Button, Input } from '../../ui';
import { useSupplierRoles, type SupplierRole } from './shared';

/**
 * Which kinds of supplier the band hires, and what it calls each of them.
 *
 * The app shipped with four — תאורן, סאונדמן, זמר/ת, חברת הגברה — and that list was in the
 * source code, so the bracelets company, א.ק.ו.ם and the hall could be costs on a show but
 * never somebody you pay: no supplier to name, no transfer to record, no invoice to chase.
 *
 * A type here is one of the show's cost lines with a name on it. That is the constraint worth
 * explaining on the screen rather than hiding: the band can call the line whatever it likes,
 * and can decide which lines it hires for at all, but the money still has to come out of a
 * line a show actually has. Switching one off hides it from the staffing without touching a
 * single show that already used it.
 */
export function SupplierRolesPanel({ isOwner, onError, onChange }: {
  isOwner: boolean;
  onError: (message: string) => void;
  onChange: () => void;
}) {
  const { roles, reload } = useSupplierRoles();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const save = async (role: SupplierRole, patch: Partial<SupplierRole> & { name?: string }) => {
    setBusy(role.key);
    onError('');
    try {
      await put(`/band/supplier-roles/${role.key}`, patch);
      reload();
      onChange();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const active = roles.filter((r) => r.active);
  const off = roles.filter((r) => !r.active);

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="ser text-lg">סוגי ספקים</h3>
          <p className="text-[13px] text-muted">
            {active.map((r) => r.name).join(' · ') || 'לא הוגדרו סוגים'}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? 'סגירה' : 'ניהול הסוגים'}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 pt-1">
          <p className="text-[13px] text-muted">
            כל סוג ספק הוא שורת עלות בהופעה שיש לה שם. מי שמשובץ בסוג הזה הוא מי שהשורה משלמת
            לו — ומכאן נגזר מה חייבים לו, איזו העברה סגרה את זה, ואיזו חשבונית עוד חסרה.
            כיבוי סוג מסתיר אותו משיבוץ בהופעות חדשות ואינו נוגע בהופעות שכבר שובצו.
          </p>

          <div className="space-y-1.5">
            {roles.map((role) => {
              const editing = draft[role.key] !== undefined;
              return (
                <div
                  key={role.key}
                  className="flex items-center gap-2 flex-wrap border-b border-line pb-2 last:border-0"
                >
                  <div className="min-w-[11rem] flex-1">
                    {editing ? (
                      <Input
                        value={draft[role.key]}
                        autoFocus
                        onChange={(e) => setDraft({ ...draft, [role.key]: e.target.value })}
                      />
                    ) : (
                      <>
                        <span className={role.active ? 'font-medium' : 'text-muted'}>{role.name}</span>
                        <span className="text-[12px] text-faint block">
                          {role.suppliers ? `${role.suppliers} ספקים · ` : ''}
                          {role.assignments ? `${role.assignments} שיבוצים` : 'אין שיבוצים'}
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
                            disabled={busy === role.key}
                            onClick={() => {
                              const name = draft[role.key];
                              const next = { ...draft };
                              delete next[role.key];
                              setDraft(next);
                              save(role, { name });
                            }}
                          >
                            שמירה
                          </button>
                          <button
                            className="text-muted hover:underline"
                            onClick={() => {
                              const next = { ...draft };
                              delete next[role.key];
                              setDraft(next);
                            }}
                          >
                            ביטול
                          </button>
                        </>
                      ) : (
                        <button
                          className="text-accent hover:underline"
                          onClick={() => setDraft({ ...draft, [role.key]: role.name })}
                        >
                          שינוי שם
                        </button>
                      )}

                      {/* Only meaningful for a role in use: a show cannot be missing somebody
                          the band does not hire. */}
                      {!!role.active && (
                        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={!!role.required}
                            onChange={(e) => save(role, { required: e.target.checked ? 1 : 0 })}
                          />
                          חובה בהופעה
                        </label>
                      )}

                      <button
                        className={role.active ? 'text-neg hover:underline' : 'text-pos hover:underline'}
                        disabled={busy === role.key}
                        onClick={() => save(role, { active: role.active ? 0 : 1 })}
                      >
                        {role.active ? 'כיבוי' : 'הפעלה'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {off.length > 0 && (
            <p className="text-[12px] text-faint">
              סוגים כבויים ({off.map((r) => r.name).join(', ')}) נשארים שורות עלות רגילות בהופעה —
              אפשר להקליד בהן סכום, אך אין למי לשייך אותו ואין חשבונית לעקוב אחריה.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
