import { Injectable } from '@nestjs/common';
import { LeadSegment } from '../enums/lead-segment.enum';

export interface CalculateLeadScoreInput {
  employees: number;
  source: string;
  phone?: string | null;
  company?: string | null;
}

export interface LeadScoreResult {
  score: number;
  segment: LeadSegment;
}

/**
 * Deterministic, side-effect-free lead scoring. This is the single source of
 * truth for score/segment — the n8n layer never computes them, and any score or
 * segment sent by the client is ignored.
 *
 * score = employees band + source weight + completeness bonus.
 */
@Injectable()
export class LeadScoringService {
  calculate(input: CalculateLeadScoreInput): LeadScoreResult {
    const score =
      this.employeeScore(input.employees) +
      this.sourceScore(input.source) +
      this.completenessScore(input);

    return { score, segment: this.segmentFor(score) };
  }

  /** Company size band. */
  private employeeScore(employees: number): number {
    const n = Number.isFinite(employees) && employees > 0 ? Math.trunc(employees) : 0;
    if (n >= 201) return 70; // 201+
    if (n >= 51) return 50; // 51–200
    if (n >= 11) return 25; // 11–50
    if (n >= 1) return 10; // 1–10
    return 0; // 0
  }

  /** Acquisition source weight (source is compared case-insensitively). */
  private sourceScore(source: string): number {
    switch ((source ?? '').trim().toLowerCase()) {
      case 'referral':
      case 'indication':
        return 20;
      case 'landing-page':
        return 10;
      case 'csv-import':
        return 5;
      default:
        return 0;
    }
  }

  /** Data completeness bonus. */
  private completenessScore(input: CalculateLeadScoreInput): number {
    let bonus = 0;
    if (input.phone && input.phone.trim().length > 0) bonus += 5;
    if (input.company && input.company.trim().length > 0) bonus += 5;
    return bonus;
  }

  /** Segmentation from the final score. */
  private segmentFor(score: number): LeadSegment {
    if (score >= 70) return 'enterprise'; // 70+
    if (score >= 30) return 'medium'; // 30–69
    return 'small'; // 0–29
  }
}
