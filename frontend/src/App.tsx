import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiKeyBar } from './components/ApiKeyBar';
import { UpsertForm } from './components/UpsertForm';
import { LeadsTable } from './components/LeadsTable';
import { ActivitiesPanel } from './components/ActivitiesPanel';
import { Toasts, type Toast } from './components/Toasts';
import { ApiError, listLeads, setApiKey } from './lib/api';
import type { Lead, Pagination } from './lib/types';

const KEY_STORAGE = 'leadops_api_key';
const LIMIT = 10;

type Connection = 'idle' | 'connected' | 'unauthorized' | 'error';

export default function App() {
  const [apiKey, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '');
  const [connection, setConnection] = useState<Connection>('idle');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((msg: string, kind: 'ok' | 'err') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    setApiKey(apiKey);
  }, [apiKey]);

  const load = useCallback(async () => {
    if (!apiKey) {
      setConnection('idle');
      setLeads([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await listLeads(page, LIMIT);
      setLeads(data.leads);
      setPagination(data.pagination);
      setConnection('connected');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setConnection('unauthorized');
        notify('401 — check your API key', 'err');
      } else {
        setConnection('error');
        notify('Failed to load leads', 'err');
      }
      setLeads([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [apiKey, page, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  function saveKey(k: string) {
    localStorage.setItem(KEY_STORAGE, k);
    setKey(k);
    setPage(1);
    notify('API key saved', 'ok');
  }

  function changePage(delta: number) {
    setPage((p) => Math.max(1, p + delta));
    setSelected(null);
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ApiKeyBar
        initialKey={apiKey}
        connection={connection}
        onSave={saveKey}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
      />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-5 p-5 lg:grid-cols-[360px_1fr]">
        <UpsertForm disabled={!apiKey} onChanged={load} notify={notify} />
        <div>
          <LeadsTable
            leads={leads}
            pagination={pagination}
            loading={loading}
            hasKey={Boolean(apiKey)}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onRefresh={load}
            onPage={changePage}
          />
          {selected && <ActivitiesPanel lead={selected} notify={notify} />}
        </div>
      </main>
      <Toasts toasts={toasts} />
    </div>
  );
}
