/**
 * Payroll calculation engine — pure, deterministic, fully traceable.
 *
 * Input: APPROVED effective work sessions (original times or the latest approved adjustment).
 * Output: regular/overtime minutes, gross pay in cents, and a trace explaining every number.
 *
 * Overtime follows the COMPANY's own policy (daily, weekly, both or none). Per overtime block (work
 * week, or averaging period) the greater of daily and block overtime is used — never both.
 */
import { POLICY_BOUNDS, type CompanyPayrollSettings } from './rules';
import { addDays, daysBetween, localDate, minutesBetween, payForMinutes, workWeekStart } from '../time';

export interface PayableSession {
  id: string;
  start: string; // ISO instant (effective)
  end: string; // ISO instant (effective)
  breakMinutes: number; // effective recorded break minutes
}

export interface EmployeePayInput {
  membershipId: string;
  hourlyRateCents: number;
  overtimeExempt: boolean;
  sessions: PayableSession[];
}

export interface DayLine {
  date: string;
  workedMinutes: number;
  dailyOvertimeMinutes: number;
  sessionIds: string[];
}

export interface BlockLine {
  kind: 'week' | 'averaging_period';
  start: string;
  end: string; // inclusive
  workedMinutes: number;
  thresholdMinutes: number;
  dailyOvertimeTotal: number;
  blockOvertime: number;
  overtimeMinutes: number; // greater of the two
  rule: string;
}

export interface Warning {
  code: 'LONG_SESSION' | 'SESSION_INVALID';
  sessionId: string;
  message: string;
}

export interface EmployeePayResult {
  membershipId: string;
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  hourlyRateCents: number;
  overtimeMultiplier: number;
  grossRegularCents: number;
  grossOvertimeCents: number;
  grossTotalCents: number;
  days: DayLine[];
  blocks: BlockLine[];
  warnings: Warning[];
  engineVersion: string;
  ruleProfile: string;
}

export const ENGINE_VERSION = '2.0.0';

/** Net paid minutes for a session after unpaid breaks. */
export function sessionPaidMinutes(s: PayableSession, paidBreaks: boolean): number {
  const gross = minutesBetween(s.start, s.end);
  const breaks = paidBreaks ? 0 : Math.min(Math.max(0, s.breakMinutes), gross);
  return gross - breaks;
}

function blockKey(date: string, settings: CompanyPayrollSettings): { start: string; end: string; kind: BlockLine['kind']; weeks: number } {
  if (settings.averaging?.enabled) {
    const len = settings.averaging.periodWeeks * 7;
    const offset = daysBetween(settings.averaging.anchorDate, date);
    const idx = Math.floor(offset / len);
    const start = addDays(settings.averaging.anchorDate, idx * len);
    return { start, end: addDays(start, len - 1), kind: 'averaging_period', weeks: settings.averaging.periodWeeks };
  }
  const start = workWeekStart(date, settings.workWeekStartDow);
  return { start, end: addDays(start, 6), kind: 'week', weeks: 1 };
}

export function calculateEmployeePay(input: EmployeePayInput, settings: CompanyPayrollSettings): EmployeePayResult {
  const warnings: Warning[] = [];
  const days = new Map<string, DayLine>();

  for (const s of input.sessions) {
    const startMs = Date.parse(s.start);
    const endMs = Date.parse(s.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      warnings.push({ code: 'SESSION_INVALID', sessionId: s.id, message: 'Session has no valid start/end and was excluded.' });
      continue;
    }
    const span = minutesBetween(s.start, s.end);
    if (span > POLICY_BOUNDS.longSessionMinutes)
      warnings.push({
        code: 'LONG_SESSION',
        sessionId: s.id,
        message: `Session lasted ${(span / 60).toFixed(1)} h. Check for a missed clock-out.`,
      });
    const date = localDate(s.start, settings.timezone);
    const line = days.get(date) ?? { date, workedMinutes: 0, dailyOvertimeMinutes: 0, sessionIds: [] };
    line.workedMinutes += sessionPaidMinutes(s, settings.paidBreaks);
    line.sessionIds.push(s.id);
    days.set(date, line);
  }

  const sortedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sortedDays) {
    d.dailyOvertimeMinutes =
      input.overtimeExempt || !settings.dailyOvertimeEnabled ? 0 : Math.max(0, d.workedMinutes - settings.dailyThresholdMinutes);
  }

  const blocks = new Map<string, BlockLine>();
  for (const d of sortedDays) {
    const k = blockKey(d.date, settings);
    const b =
      blocks.get(k.start) ??
      ({
        kind: k.kind,
        start: k.start,
        end: k.end,
        workedMinutes: 0,
        thresholdMinutes: settings.weeklyThresholdMinutes * k.weeks,
        dailyOvertimeTotal: 0,
        blockOvertime: 0,
        overtimeMinutes: 0,
        rule: '',
      } satisfies BlockLine);
    b.workedMinutes += d.workedMinutes;
    b.dailyOvertimeTotal += d.dailyOvertimeMinutes;
    blocks.set(k.start, b);
  }

  let overtime = 0;
  let worked = 0;
  for (const b of blocks.values()) {
    worked += b.workedMinutes;
    if (input.overtimeExempt) {
      b.blockOvertime = 0;
      b.dailyOvertimeTotal = 0;
      b.overtimeMinutes = 0;
      b.rule = 'Employee is marked overtime-exempt.';
      continue;
    }
    b.blockOvertime = settings.weeklyOvertimeEnabled ? Math.max(0, b.workedMinutes - b.thresholdMinutes) : 0;
    // Never both: the greater of daily and weekly overtime is paid (no double counting).
    b.overtimeMinutes = Math.max(b.dailyOvertimeTotal, b.blockOvertime);
    b.rule = !settings.dailyOvertimeEnabled && !settings.weeklyOvertimeEnabled
      ? 'Company policy: no overtime.'
      : `Company policy: greater of daily overtime (${b.dailyOvertimeTotal} min) and ` +
        `${b.kind === 'week' ? 'weekly' : 'averaging-period'} overtime (${b.blockOvertime} min over ${b.thresholdMinutes} min).`;
    overtime += b.overtimeMinutes;
  }

  const regular = worked - overtime;
  const grossRegular = payForMinutes(regular, input.hourlyRateCents);
  const grossOvertime = payForMinutes(overtime, input.hourlyRateCents, settings.overtimeMultiplier);

  return {
    membershipId: input.membershipId,
    workedMinutes: worked,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    hourlyRateCents: input.hourlyRateCents,
    overtimeMultiplier: settings.overtimeMultiplier,
    grossRegularCents: grossRegular,
    grossOvertimeCents: grossOvertime,
    grossTotalCents: grossRegular + grossOvertime,
    days: sortedDays,
    blocks: [...blocks.values()].sort((a, b) => a.start.localeCompare(b.start)),
    warnings,
    engineVersion: ENGINE_VERSION,
    ruleProfile: settings.ruleProfile,
  };
}

/**
 * Overtime blocks must be complete to be calculated correctly. Given a pay period, return the
 * date range of sessions the caller must load: from the start of the first block that ends inside
 * the period, to the end of the last block that ends inside the period. Blocks are attributed to
 * the pay period in which they END (documented in docs/Legal-Review.md).
 */
export function blocksEndingInPeriod(periodStart: string, periodEnd: string, settings: CompanyPayrollSettings) {
  const result: { start: string; end: string }[] = [];
  // Walk back far enough to find blocks ending inside the period.
  let cursor = addDays(periodStart, -(settings.averaging?.enabled ? settings.averaging.periodWeeks * 7 : 7));
  const seen = new Set<string>();
  while (cursor <= periodEnd) {
    const k = blockKey(cursor, settings);
    if (!seen.has(k.start) && k.end >= periodStart && k.end <= periodEnd) {
      result.push({ start: k.start, end: k.end });
      seen.add(k.start);
    }
    cursor = addDays(cursor, 1);
  }
  return result;
}
