import { useState } from 'react';

interface Props {
  initialKey: string;
  connection: 'idle' | 'connected' | 'unauthorized' | 'error';
  onSave: (key: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
}

const connLabel: Record<Props['connection'], { text: string; cls: string }> = {
  idle: { text: 'not connected', cls: 'text-slate-500' },
  connected: { text: 'connected', cls: 'text-emerald-500' },
  unauthorized: { text: 'unauthorized', cls: 'text-red-500' },
  error: { text: 'error', cls: 'text-red-500' },
};

export function ApiKeyBar({ initialKey, connection, onSave, dark, onToggleTheme }: Props) {
  const [value, setValue] = useState(initialKey);
  const conn = connLabel[connection];

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-base font-semibold">
        LeadOps <span className="text-slate-500">Dashboard</span>
      </h1>
      <span
        className={`rounded-full border border-slate-200 px-2 py-0.5 text-xs dark:border-slate-700 ${conn.cls}`}
      >
        {conn.text}
      </span>
      <div className="flex-1" />
      <label className="text-xs text-slate-500">API key</label>
      <input
        type="password"
        value={value}
        placeholder="X-API-Key"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave(value.trim())}
        className="w-56 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
      />
      <button
        onClick={() => onSave(value.trim())}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
      >
        Save
      </button>
      <button
        onClick={onToggleTheme}
        aria-label="Toggle theme"
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700"
      >
        {dark ? '☀' : '☾'}
      </button>
    </header>
  );
}
