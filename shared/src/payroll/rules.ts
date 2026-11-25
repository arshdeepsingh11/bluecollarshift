/**
 * Employment-rules profiles.
 *
 * A profile defines the LEGAL MINIMUMS for a jurisdiction. Company settings may be
 * MORE generous than the profile (e.g. overtime after 7.5 h), never less.
 * New provinces are added as new profiles — the engine does not change.
 *
 * Sources (Alberta, retrieved Nov 2026):
 *  - alberta.ca/overtime-hours-overtime-pay — "Overtime is all hours worked over 8 hours a day
 *    or 44 hours a week, whichever is greater (8/44 rule)."
 *  - Employment Standards Tool Kit Module 4 — daily and weekly totals are both calculated; the
 *    greater is paid (no double counting).
 *  - alberta.ca/averaging-arrangements — overtime is the greater of daily overtime or averaging-
 *    period overtime (average of 44 h/week).
 * See docs/Legal-Review.md for assumptions that need confirmation by an employment lawyer.
 */

export const RULE_PROFILE_IDS = ['AB_STANDARD'] as const;
export type RuleProfileId = (typeof RULE_PROFILE_IDS)[number];

export interface RuleProfile {
  id: RuleProfileId;
  name: string;
  jurisdiction: string;
  /** Maximum daily minutes before overtime (legal minimum standard). */
  maxDailyThresholdMinutes: number;
  /** Maximum weekly minutes before overtime. */
  maxWeeklyThresholdMinutes: number;
  /** Minimum overtime pay multiplier. */
  minOvertimeMultiplier: number;
  /** Overtime = greater of daily total and weekly total (true) vs. sum (false). */
  greaterOfDailyOrWeekly: boolean;
  /** Longest averaging period allowed, in weeks. */
  maxAveragingWeeks: number;
  /** A rest period of `restBreakMinutes` is required within each `restBreakEveryMinutes` of work. */
  restBreakEveryMinutes: number;
  restBreakMinutes: number;
  /** Hours of work should be confined within this many minutes in a work day. */
  maxWorkDaySpanMinutes: number;
  /** Banked overtime ratio under an overtime agreement (hours banked per OT hour). */
  bankedOvertimeRatio: number;
  legalReviewNotes: string[];
}

export const RULE_PROFILES: Record<RuleProfileId, RuleProfile> = {
  AB_STANDARD: {
    id: 'AB_STANDARD',
    name: 'Alberta — standard (8/44)',
    jurisdiction: 'CA-AB',
    maxDailyThresholdMinutes: 8 * 60,
    maxWeeklyThresholdMinutes: 44 * 60,
    minOvertimeMultiplier: 1.5,
    greaterOfDailyOrWeekly: true,
    maxAveragingWeeks: 52,
    restBreakEveryMinutes: 5 * 60,
    restBreakMinutes: 30,
    maxWorkDaySpanMinutes: 12 * 60,
    bankedOvertimeRatio: 1,
    legalReviewNotes: [
      'Hours are attributed to the local calendar day on which the work session started.',
      'Exempt occupations (managers, supervisors, confidential roles, some industries) must be marked as overtime-exempt per employee.',
      'Banked overtime ratio under an overtime agreement assumed 1:1 — confirm current Code.',
      'Averaging-arrangement overtime threshold assumed to be 44 h × weeks in the averaging period.',
      'Rest-period check (30 min per 5 h) produces warnings only; it does not change pay.',
    ],
  },
};

export interface CompanyPayrollSettings {
  ruleProfile: RuleProfileId;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workWeekStartDow: number;
  dailyThresholdMinutes: number;
  weeklyThresholdMinutes: number;
  overtimeMultiplier: number;
  /** If true, recorded breaks are paid; otherwise they are deducted. */
  paidBreaks: boolean;
  averaging: { enabled: boolean; periodWeeks: number; anchorDate: string } | null;
  /** Employees under an overtime agreement may bank overtime instead of pay. */
  overtimeAgreementBanking: boolean;
}

export const DEFAULT_PAYROLL_SETTINGS: CompanyPayrollSettings = {
  ruleProfile: 'AB_STANDARD',
  timezone: 'America/Edmonton',
  workWeekStartDow: 0,
  dailyThresholdMinutes: 480,
  weeklyThresholdMinutes: 2640,
  overtimeMultiplier: 1.5,
  paidBreaks: false,
  averaging: null,
  overtimeAgreementBanking: false,
};

export interface SettingsViolation {
  field: keyof CompanyPayrollSettings | 'averaging.periodWeeks';
  message: string;
}

/** Reject settings that would fall below the legal minimum for the profile. */
export function validatePayrollSettings(s: CompanyPayrollSettings): SettingsViolation[] {
  const p = RULE_PROFILES[s.ruleProfile];
  const v: SettingsViolation[] = [];
  if (!p) return [{ field: 'ruleProfile', message: 'Unknown rule profile' }];
  if (s.dailyThresholdMinutes > p.maxDailyThresholdMinutes || s.dailyThresholdMinutes < 60)
    v.push({
      field: 'dailyThresholdMinutes',
      message: `Daily overtime must start at or before ${p.maxDailyThresholdMinutes / 60} hours (${p.name}).`,
    });
  if (s.weeklyThresholdMinutes > p.maxWeeklyThresholdMinutes || s.weeklyThresholdMinutes < 60)
    v.push({
      field: 'weeklyThresholdMinutes',
      message: `Weekly overtime must start at or before ${p.maxWeeklyThresholdMinutes / 60} hours (${p.name}).`,
    });
  if (s.overtimeMultiplier < p.minOvertimeMultiplier || s.overtimeMultiplier > 5)
    v.push({
      field: 'overtimeMultiplier',
      message: `Overtime rate must be at least ${p.minOvertimeMultiplier}× regular pay.`,
    });
  if (s.workWeekStartDow < 0 || s.workWeekStartDow > 6 || !Number.isInteger(s.workWeekStartDow))
    v.push({ field: 'workWeekStartDow', message: 'Work week must start on a day 0–6.' });
  if (s.averaging?.enabled) {
    if (s.averaging.periodWeeks < 1 || s.averaging.periodWeeks > p.maxAveragingWeeks)
      v.push({
        field: 'averaging.periodWeeks',
        message: `Averaging period must be 1–${p.maxAveragingWeeks} weeks.`,
      });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.averaging.anchorDate))
      v.push({ field: 'averaging', message: 'Averaging arrangement needs a start date.' });
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone });
  } catch {
    v.push({ field: 'timezone', message: 'Unknown time zone.' });
  }
  return v;
}
