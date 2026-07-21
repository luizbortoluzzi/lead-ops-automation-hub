import { useCallback, useEffect, useState } from 'react';
import { addActivity, listActivities, ApiError } from '../lib/api';
import type { Lead, LeadActivity, LeadActivityType } from '../lib/types';

const TYPES: LeadActivityType[] = [
  'AUTOMATION_PROCESSED',
  'ENTERPRISE_NOTIFICATION_SENT',
  'AUTOMATION_NOTIFICATION_FAILED',
];

interface Props {
  lead: Lead;
  notify: (msg: string, kind: 'ok' | 'err') => void;
}

export function ActivitiesPanel({ lead, notify }: Props) {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [type, setType] = useState<LeadActivityType>('AUTOMATION_PROCESSED');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listActivities(lead.id);
      setActivities(data);
    } catch (err) {
      const code = err instanceof ApiError ? `${err.status} ${err.code}` : 'error';
      notify(`Activities failed: ${code}`, 'err');
    } finally {
      setLoading(false);
    }
  }, [lead.id, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    try {
      await addActivity(lead.id, {
        type,
        description: description || 'manual',
        metadata: { via: 'dashboard' },
      });
      setDescription('');
      notify('Activity added', 'ok');
      void load();
    } catch (err) {
      const code = err instanceof ApiError ? `${err.status} ${err.code}` : 'error';
      notify(`Add failed: ${code}`, 'err');
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Activities · {lead.name}
      </h2>

      {loading ? (
        <p className="py-3 text-center text-sm text-slate-500">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-500">No activities.</p>
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
            >
              <div className="text-xs font-semibold">{a.type}</div>
              <div className="text-sm">{a.description}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                cid: {a.correlationId ?? '-'} · {new Date(a.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as LeadActivityType)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          onClick={add}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}
