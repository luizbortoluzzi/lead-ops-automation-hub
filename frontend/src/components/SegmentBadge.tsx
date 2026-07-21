import type { LeadSegment } from '../lib/types';

const styles: Record<LeadSegment, string> = {
  small: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  medium: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  enterprise: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

export function SegmentBadge({ segment }: { segment: LeadSegment }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[segment]}`}>
      {segment}
    </span>
  );
}
