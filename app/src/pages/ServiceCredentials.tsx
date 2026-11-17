import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { get, post } from '../api';
import { Button, Card, Empty, Input } from '../ui';
import { refreshIntegrations } from '../sync';

/** What the server will say about one key — a secret only as "saved, ending in …". */
interface FieldView {
  env: string;
  label: string;
  secret: boolean;
  placeholder: string;
  source: 'ui' | 'env' | 'none';
  set: boolean;
  unreadable: boolean;
  value: string;
  hint: string;
}

interface ServiceView {
  key: string;
  label: string;
  how_to: string;
  configured: boolean;
  fields: FieldView[];
  uses_env: boolean;
  failing_since: string | null;
  last_error: string | null;
}

interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * The keys of the services the app syncs with, one card per service.
 *
 * Built for the day a key is revoked: make a new one in the service, paste it here, and the save
 * tests it against the service in the same click. Whatever is saved here wins over `.env`; a field
 * left empty keeps what is already in effect, and «חזרה ל-.env» forgets a saved key.
 */
export function ServiceCredentials({ onChanged }: { onChanged?: () => void }) {
  const [services, setServices] = useState<ServiceView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/settings/credentials')
      .then((d) => setServices(d.services))
      .catch((e) => setError(e.message));
  }, []);

  const replace = (next: ServiceView) => {
    setServices((list) => list?.map((s) => (s.key === next.key ? next : s)) ?? null);
    onChanged?.();
    // The sync buttons on the data pages read "configured" from the same status.
    refreshIntegrations();
  };

  if (error) return <div className="text-sm text-neg">{error}</div>;
  if (!services) return <Empty text="טוען…" />;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {services.map((service) => (
        <ServiceCard key={service.key} service={service} onSaved={replace} />
      ))}
    </div>
  );
}

function ServiceCard({ service, onSaved }: { service: ServiceView; onSaved: (s: ServiceView) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  const typed = Object.values(values).some((v) => v.trim());

  const send = async (body: { values?: Record<string, string>; clear?: string[] }) => {
    setBusy('save');
    setError('');
    setResult(null);
    try {
      const d = await post(`/settings/credentials/${service.key}`, body);
      setValues({});
      onSaved(d.service);
      setResult(d.test ?? { ok: true, message: 'נשמר' });
    } catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    send({ values });
  };

  const forget = (field: FieldView) => {
    const fallback = field.source === 'ui' ? 'הערך מקובץ .env (אם קיים) ישמש במקומו.' : '';
    if (!confirm(`למחוק את «${field.label}» השמור? ${fallback}`)) return;
    send({ clear: [field.env] });
  };

  const test = async () => {
    setBusy('test');
    setError('');
    setResult(null);
    try {
      const d = await post(`/settings/credentials/${service.key}/test`);
      setResult(d.test);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  };

  const failing = service.configured && service.last_error;

  return (
    <form onSubmit={save} className="bg-soft border border-line rounded-xl p-3 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full shrink-0',
            failing ? 'bg-neg' : service.configured ? 'bg-pos' : 'bg-line-strong')} />
          <span className="font-medium">{service.label}</span>
          <span className={clsx('text-xs', failing ? 'text-neg' : service.configured ? 'text-pos' : 'text-faint')}>
            {failing ? 'החיבור נכשל' : service.configured ? 'מוגדר' : 'לא מוגדר'}
          </span>
        </div>
        {failing && (
          <div className="text-xs text-neg mt-1 break-words">
            {service.failing_since && `מאז ${new Date(service.failing_since).toLocaleString('he-IL')}: `}
            {service.last_error}
          </div>
        )}
        <p className="text-xs text-faint mt-1 leading-relaxed">{service.how_to}</p>
      </div>

      {service.fields.map((field) => (
        <div key={field.env}>
          <Input
            label={field.label}
            dir="ltr"
            type={field.secret ? 'password' : 'text'}
            autoComplete={field.secret ? 'new-password' : 'off'}
            spellCheck={false}
            placeholder={
              field.secret
                ? field.set ? field.hint : field.placeholder
                : field.value || field.placeholder
            }
            value={values[field.env] ?? ''}
            onChange={(e) => setValues({ ...values, [field.env]: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px]">
            {field.unreadable ? (
              <span className="text-neg">הערך השמור לא ניתן לפענוח (מפתח ההצפנה השתנה) — הזינו אותו שוב</span>
            ) : field.source === 'ui' ? (
              <span className="text-pos">נשמר כאן{field.secret && ' · השאירו ריק כדי לא לשנות'}</span>
            ) : field.source === 'env' ? (
              <span className="text-warn">מגיע מקובץ .env{field.secret && ' · השאירו ריק כדי לא לשנות'}</span>
            ) : (
              <span className="text-faint">חסר</span>
            )}
            {field.source === 'ui' && (
              <button type="button" onClick={() => forget(field)} disabled={!!busy}
                className="text-neg hover:underline disabled:opacity-50">
                מחיקה
              </button>
            )}
          </div>
        </div>
      ))}

      {result && (
        <div className={clsx('rounded-lg p-2 text-xs border break-words',
          result.ok ? 'bg-pos-soft border-pos/25 text-pos' : 'bg-neg-soft border-neg/25 text-neg')}>
          {result.ok ? '✓ ' : '✗ '}{result.message}
        </div>
      )}
      {error && <div className="text-xs text-neg">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!typed || !!busy}>
          {busy === 'save' ? 'שומר ובודק…' : 'שמירה ובדיקה'}
        </Button>
        <Button variant="ghost" onClick={test} disabled={!service.configured || !!busy}>
          {busy === 'test' ? 'בודק…' : 'בדיקת חיבור'}
        </Button>
      </div>
    </form>
  );
}
