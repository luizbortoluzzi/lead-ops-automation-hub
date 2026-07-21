import { useState } from 'react';
import { upsertLead, ApiError } from '../lib/api';
import type { Lead, UpsertOperation } from '../lib/types';
import { SegmentBadge } from './SegmentBadge';

interface Props {
  disabled: boolean;
  onChanged: () => void;
  notify: (msg: string, kind: 'ok' | 'err') => void;
}

const empty = {
  name: '',
  email: '',
  externalId: '',
  source: '',
  phone: '',
  company: '',
  employees: '0',
};

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800';

export function UpsertForm({ disabled, onChanged, notify }: Props) {
  const [form, setForm] = useState({ ...empty });
  const [result, setResult] = useState<{ lead: Lead; operation: UpsertOperation } | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await upsertLead({
        name: form.name,
        email: form.email,
        externalId: form.externalId || undefined,
        source: form.source || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        employees: Number(form.employees) || 0,
      });
      setResult(data);
      notify(`Lead ${data.operation}`, 'ok');
      onChanged();
    } catch (err) {
      const code = err instanceof ApiError ? `${err.status} ${err.code}` : 'error';
      notify(`Upsert failed: ${code}`, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Upsert lead
      </h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Name *</label>
          <input required value={form.name} onChange={set('name')} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Email *</label>
          <input
            required
            type="email"
            value={form.email}
            onChange={set('email')}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">External ID</label>
            <input value={form.externalId} onChange={set('externalId')} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Source</label>
            <select value={form.source} onChange={set('source')} className={inputCls}>
              <option value="">(none)</option>
              <option>landing-page</option>
              <option>referral</option>
              <option>indication</option>
              <option>csv-import</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Phone</label>
            <input value={form.phone} onChange={set('phone')} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Company</label>
            <input value={form.company} onChange={set('company')} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Employees</label>
          <input
            type="number"
            min={0}
            value={form.employees}
            onChange={set('employees')}
            className={inputCls}
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={disabled || busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Upsert'}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({ ...empty });
              setResult(null);
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700"
          >
            Clear
          </button>
        </div>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        Score &amp; segment are computed by the backend — any you send are ignored.
      </p>
      {result && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
          <b>{result.operation}</b> · score <b>{result.lead.score}</b>{' '}
          <SegmentBadge segment={result.lead.segment} />
          <div className="mt-1 text-xs text-slate-500">id: {result.lead.id}</div>
        </div>
      )}
    </section>
  );
}
