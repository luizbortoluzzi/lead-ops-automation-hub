import type { Lead, Pagination } from '../lib/types';
import { SegmentBadge } from './SegmentBadge';

interface Props {
  leads: Lead[];
  pagination: Pagination | null;
  loading: boolean;
  hasKey: boolean;
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  onRefresh: () => void;
  onPage: (delta: number) => void;
}

export function LeadsTable({
  leads,
  pagination,
  loading,
  hasKey,
  selectedId,
  onSelect,
  onRefresh,
  onPage,
}: Props) {
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leads</h2>
        <button
          onClick={onRefresh}
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm dark:border-slate-700"
        >
          Refresh
        </button>
      </div>

      {!hasKey ? (
        <p className="py-6 text-center text-sm text-slate-500">Enter your API key to load leads.</p>
      ) : loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No leads yet. Upsert one.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="border-b border-slate-200 p-2 font-semibold dark:border-slate-700">
                  Name
                </th>
                <th className="border-b border-slate-200 p-2 font-semibold dark:border-slate-700">
                  Email
                </th>
                <th className="border-b border-slate-200 p-2 font-semibold dark:border-slate-700">
                  Emp.
                </th>
                <th className="border-b border-slate-200 p-2 font-semibold dark:border-slate-700">
                  Score
                </th>
                <th className="border-b border-slate-200 p-2 font-semibold dark:border-slate-700">
                  Segment
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => onSelect(l)}
                  className={`cursor-pointer ${
                    selectedId === l.id
                      ? 'bg-blue-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <td className="border-b border-slate-100 p-2 dark:border-slate-800">{l.name}</td>
                  <td className="border-b border-slate-100 p-2 text-slate-500 dark:border-slate-800">
                    {l.email}
                  </td>
                  <td className="border-b border-slate-100 p-2 dark:border-slate-800">
                    {l.employees}
                  </td>
                  <td className="border-b border-slate-100 p-2 dark:border-slate-800">{l.score}</td>
                  <td className="border-b border-slate-100 p-2 dark:border-slate-800">
                    <SegmentBadge segment={l.segment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && leads.length > 0 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button
            onClick={() => onPage(-1)}
            disabled={pagination.page <= 1}
            className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
          >
            Prev
          </button>
          <span className="whitespace-nowrap text-slate-500">
            page {pagination.page}/{totalPages} · {pagination.total} leads
          </span>
          <button
            onClick={() => onPage(1)}
            disabled={!pagination.hasNextPage}
            className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
