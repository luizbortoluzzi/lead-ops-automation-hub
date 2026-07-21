import { describe, expect, it } from 'vitest';
import { LeadScoringService } from '../../src/modules/leads/services/lead-scoring.service';

const scoring = new LeadScoringService();

const base = { employees: 0, source: 'unknown', phone: null, company: null };

describe('LeadScoringService — employee bands', () => {
  it('scores 0 employees as 0', () => {
    expect(scoring.calculate({ ...base, employees: 0 }).score).toBe(0);
  });

  it('scores 1–10 employees as 10', () => {
    expect(scoring.calculate({ ...base, employees: 1 }).score).toBe(10);
    expect(scoring.calculate({ ...base, employees: 10 }).score).toBe(10);
  });

  it('scores 11–50 employees as 25', () => {
    expect(scoring.calculate({ ...base, employees: 11 }).score).toBe(25);
    expect(scoring.calculate({ ...base, employees: 50 }).score).toBe(25);
  });

  it('scores 51–200 employees as 50', () => {
    expect(scoring.calculate({ ...base, employees: 51 }).score).toBe(50);
    expect(scoring.calculate({ ...base, employees: 200 }).score).toBe(50);
  });

  it('scores 201+ employees as 70', () => {
    expect(scoring.calculate({ ...base, employees: 201 }).score).toBe(70);
    expect(scoring.calculate({ ...base, employees: 5000 }).score).toBe(70);
  });
});

describe('LeadScoringService — source weights', () => {
  it('adds 20 for referral', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: 'referral' }).score).toBe(30);
  });

  it('adds 20 for indication', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: 'indication' }).score).toBe(30);
  });

  it('adds 10 for landing-page', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: 'landing-page' }).score).toBe(20);
  });

  it('adds 5 for csv-import', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: 'csv-import' }).score).toBe(15);
  });

  it('adds 0 for unknown sources', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: 'twitter' }).score).toBe(10);
  });

  it('normalizes source case/whitespace', () => {
    expect(scoring.calculate({ ...base, employees: 5, source: '  LANDING-PAGE ' }).score).toBe(20);
  });
});

describe('LeadScoringService — completeness bonus', () => {
  it('adds 5 when phone is present', () => {
    expect(scoring.calculate({ ...base, employees: 5, phone: '5511999998888' }).score).toBe(15);
  });

  it('adds 5 when company is present', () => {
    expect(scoring.calculate({ ...base, employees: 5, company: 'Acme' }).score).toBe(15);
  });
});

describe('LeadScoringService — segmentation', () => {
  it('maps 0–29 to small', () => {
    expect(scoring.calculate({ ...base, employees: 10 }).segment).toBe('small'); // 10
  });

  it('maps 30–69 to medium', () => {
    expect(scoring.calculate({ ...base, employees: 100 }).segment).toBe('medium'); // 50
  });

  it('maps 70+ to enterprise', () => {
    // 100 employees (50) + referral (20) = 70 → enterprise
    const result = scoring.calculate({
      employees: 100,
      source: 'referral',
      phone: null,
      company: null,
    });
    expect(result.score).toBe(70);
    expect(result.segment).toBe('enterprise');
  });
});
