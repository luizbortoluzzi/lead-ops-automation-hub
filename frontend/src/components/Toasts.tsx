export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err';
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-sm rounded-lg border px-4 py-2 text-sm shadow-lg ${
            t.kind === 'ok'
              ? 'border-emerald-500 bg-white dark:bg-slate-800'
              : 'border-red-500 bg-white dark:bg-slate-800'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
