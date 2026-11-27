/**
 * Company pay policy.
 *
 * Blue Collar does not apply any province, state or country rules. Each company sets its own
 * overtime policy (daily, weekly, both or none, and the multiplier) to match its own policy and
 * the laws it is responsible for. The engine only enforces sanity bounds.
 */

export const RULE_PROFILE_IDS = ['COMPANY_POLICY'] as const;
export type RuleProfileId = (typeof RULE_PROFILE_IDS)[number];

export const CURRENCIES = ['CAD', 'USD', 'MXN'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const COUNTRIES = ['CA', 'US', 'MX'] as const;
export type Country = (typeof COUNTRIES)[number];

/** Sanity bounds (not legal rules). */
export const POLICY_BOUNDS = {
  minThresholdMinutes: 60,
  maxDailyThresholdMinutes: 24 * 60,
  maxWeeklyThresholdMinutes: 7 * 24 * 60,
  minMultiplier: 1,
  maxMultiplier: 5,
  maxAveragingWeeks: 52,
  /** Sessions longer than this are flagged for a human to check (probably a missed clock-out). */
  longSessionMinutes: 16 * 60,
} as const;

export interface CompanyPayrollSettings {
  ruleProfile: RuleProfileId;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workWeekStartDow: number;
  dailyOvertimeEnabled: boolean;
  dailyThresholdMinutes: number;
  weeklyOvertimeEnabled: boolean;
  weeklyThresholdMinutes: number;
  overtimeMultiplier: number;
  /** If true, recorded breaks are paid; otherwise they are deducted. */
  paidBreaks: boolean;
  /** Optional multi-week averaging of the weekly threshold. */
  averaging: { enabled: boolean; periodWeeks: number; anchorDate: string } | null;
  /** Employees under an overtime agreement may bank overtime instead of pay. */
  overtimeAgreementBanking: boolean;
}

/** A common starting point. Every value is editable by the company. */
export const DEFAULT_PAYROLL_SETTINGS: CompanyPayrollSettings = {
  ruleProfile: 'COMPANY_POLICY',
  timezone: 'America/Toronto',
  workWeekStartDow: 0,
  dailyOvertimeEnabled: true,
  dailyThresholdMinutes: 480,
  weeklyOvertimeEnabled: true,
  weeklyThresholdMinutes: 2400,
  overtimeMultiplier: 1.5,
  paidBreaks: false,
  averaging: null,
  overtimeAgreementBanking: false,
};

export interface SettingsViolation {
  field: keyof CompanyPayrollSettings | 'averaging.periodWeeks';
  message: string;
}

/** Reject settings that are impossible or nonsensical. No legal rules are applied here. */
export function validatePayrollSettings(s: CompanyPayrollSettings): SettingsViolation[] {
  const b = POLICY_BOUNDS;
  const v: SettingsViolation[] = [];
  if (!RULE_PROFILE_IDS.includes(s.ruleProfile)) v.push({ field: 'ruleProfile', message: 'Unknown pay policy.' });
  if (s.dailyThresholdMinutes < b.minThresholdMinutes || s.dailyThresholdMinutes > b.maxDailyThresholdMinutes)
    v.push({ field: 'dailyThresholdMinutes', message: 'Daily overtime must start between 1 and 24 hours.' });
  if (s.weeklyThresholdMinutes < b.minThresholdMinutes || s.weeklyThresholdMinutes > b.maxWeeklyThresholdMinutes)
    v.push({ field: 'weeklyThresholdMinutes', message: 'Weekly overtime must start between 1 and 168 hours.' });
  if (!(s.overtimeMultiplier >= b.minMultiplier && s.overtimeMultiplier <= b.maxMultiplier))
    v.push({ field: 'overtimeMultiplier', message: 'Overtime rate must be between 1× and 5× regular pay.' });
  if (s.workWeekStartDow < 0 || s.workWeekStartDow > 6 || !Number.isInteger(s.workWeekStartDow))
    v.push({ field: 'workWeekStartDow', message: 'Work week must start on a day 0–6.' });
  if (s.averaging?.enabled) {
    if (s.averaging.periodWeeks < 1 || s.averaging.periodWeeks > b.maxAveragingWeeks)
      v.push({ field: 'averaging.periodWeeks', message: `Averaging period must be 1–${b.maxAveragingWeeks} weeks.` });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.averaging.anchorDate))
      v.push({ field: 'averaging', message: 'Averaging needs a start date.' });
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone });
  } catch {
    v.push({ field: 'timezone', message: 'Unknown time zone.' });
  }
  return v;
}

/** True when the company pays any overtime at all. */
export function overtimeEnabled(s: Pick<CompanyPayrollSettings, 'dailyOvertimeEnabled' | 'weeklyOvertimeEnabled'>) {
  return s.dailyOvertimeEnabled || s.weeklyOvertimeEnabled;
}
