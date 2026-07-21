export const LEAD_SEGMENTS = ['small', 'medium', 'enterprise'] as const;

export type LeadSegment = (typeof LEAD_SEGMENTS)[number];
