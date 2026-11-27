import { describe, expect, it } from 'vitest';
import {
  blocksEndingInPeriod,
  calculateEmployeePay,
  DEFAULT_PAYROLL_SETTINGS,
  validatePayrollSettings,
  type CompanyPayrollSettings,
  type PayableSession,
} from '../src';

// Edmonton is UTC-7 (MST) in January. 08:00 local = 15:00Z.
const day = (date: string, startH: number, hours: number, breakMinutes = 0, id = `${date}-${startH}`): PayableSession => {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) + (startH + 7) * 3600_000);
  const end = new Date(start.getTime() + hours * 3600_000);
  return { id, start: start.toISOString(), end: end.toISOString(), breakMinutes };
};

const S: CompanyPayrollSettings = { ...DEFAULT_PAYROLL_SETTINGS, timezone: 'America/Edmonton', weeklyThresholdMinutes: 2640 };
const pay = (sessions: PayableSession[], settings = S, rate = 3000) =>
  calculateEmployeePay({ membershipId: 'm1', hourlyRateCents: rate, overtimeExempt: false, sessions }, settings);

describe('company overtime policy (example: 8 h/day, 44 h/week)', () => {
  it('no overtime for a normal 40-hour week', () => {
    // Sun 2027-01-03 starts the week (workWeekStartDow 0). Mon–Fri 8h.
    const r = pay(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'].map((d) => day(d, 8, 8)));
    expect(r.workedMinutes).toBe(2400);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.grossTotalCents).toBe(40 * 3000);
  });

  it('daily overtime when a day exceeds 8 hours', () => {
    const r = pay([day('2027-01-04', 7, 10)]);
    expect(r.overtimeMinutes).toBe(120);
    expect(r.regularMinutes).toBe(480);
    expect(r.grossOvertimeCents).toBe(Math.round(120 * 3000 * 1.5 / 60));
  });

  it('weekly overtime when 6 days × 8h = 48h (no daily OT)', () => {
    const r = pay(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09'].map((d) => day(d, 8, 8)));
    expect(r.workedMinutes).toBe(48 * 60);
    expect(r.overtimeMinutes).toBe(4 * 60);
  });

  it('takes the GREATER of daily and weekly — never both (no double counting)', () => {
    // 5 days × 10h = 50h. Daily OT = 5×2 = 10h. Weekly OT = 50-44 = 6h. Pay 10h, not 16h.
    const r = pay(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'].map((d) => day(d, 7, 10)));
    expect(r.overtimeMinutes).toBe(600);
    expect(r.blocks[0]?.dailyOvertimeTotal).toBe(600);
    expect(r.blocks[0]?.blockOvertime).toBe(360);
  });

  it('weekly overtime wins when greater than daily', () => {
    // 6 days: 9h, 8h ×5 = 49h. Daily OT 1h, weekly OT 5h → 5h.
    const sessions = [day('2027-01-04', 7, 9), ...['2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09'].map((d) => day(d, 8, 8))];
    expect(pay(sessions).overtimeMinutes).toBe(300);
  });

  it('unpaid breaks are deducted, paid breaks are not', () => {
    const s = [day('2027-01-04', 8, 9, 30)];
    expect(pay(s).workedMinutes).toBe(510);
    expect(pay(s, { ...S, paidBreaks: true }).workedMinutes).toBe(540);
  });

  it('splits weeks on the configured work-week start day', () => {
    // Monday-start weeks: Sun 2027-01-10 belongs to the week of Mon 2027-01-04.
    const sessions = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-10'].map((d) => day(d, 8, 8));
    expect(pay(sessions, { ...S, workWeekStartDow: 1 }).overtimeMinutes).toBe(240);
    // Sunday-start weeks: the Sunday starts a new week, so 40h + 8h → no weekly OT.
    expect(pay(sessions, { ...S, workWeekStartDow: 0 }).overtimeMinutes).toBe(0);
  });

  it('attributes a shift crossing midnight to its start day', () => {
    const r = pay([day('2027-01-04', 20, 10)]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]?.date).toBe('2027-01-04');
    expect(r.overtimeMinutes).toBe(120);
  });

  it('overtime-exempt employees get no overtime', () => {
    const r = calculateEmployeePay(
      { membershipId: 'm', hourlyRateCents: 3000, overtimeExempt: true, sessions: [day('2027-01-04', 6, 12)] },
      S,
    );
    expect(r.overtimeMinutes).toBe(0);
    expect(r.grossTotalCents).toBe(12 * 3000);
  });

  it('more generous company thresholds are honoured (OT after 7.5h)', () => {
    expect(pay([day('2027-01-04', 8, 8)], { ...S, dailyThresholdMinutes: 450 }).overtimeMinutes).toBe(30);
  });

  it('averaging arrangement: greater of daily OT and period OT (44 × weeks)', () => {
    const avg: CompanyPayrollSettings = { ...S, averaging: { enabled: true, periodWeeks: 2, anchorDate: '2027-01-03' } };
    // Week 1: 4 × 12h = 48h, week 2: 4 × 8h = 32h. Total 80h ≤ 88h → period OT 0; daily OT 4×4=16h.
    const w1 = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07'].map((d) => day(d, 6, 12));
    const w2 = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14'].map((d) => day(d, 8, 8));
    const r = pay([...w1, ...w2], avg);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.thresholdMinutes).toBe(88 * 60);
    expect(r.overtimeMinutes).toBe(16 * 60);
  });

  it('flags sessions over 16 h as a possible missed clock-out', () => {
    expect(pay([day('2027-01-04', 5, 13)]).warnings).toEqual([]);
    expect(pay([day('2027-01-04', 2, 17)]).warnings.map((w) => w.code)).toEqual(['LONG_SESSION']);
  });

  it('weekly-only policy (e.g. 40 h/week): long days are not overtime', () => {
    const weekly = { ...S, dailyOvertimeEnabled: false, weeklyThresholdMinutes: 2400 };
    expect(pay([day('2027-01-04', 6, 12)], weekly).overtimeMinutes).toBe(0);
    const r = pay(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07'].map((d) => day(d, 6, 11)), weekly);
    expect(r.overtimeMinutes).toBe(4 * 60);
  });

  it('daily-only policy: weekly hours never create overtime', () => {
    const daily = { ...S, weeklyOvertimeEnabled: false };
    const sessions = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09'].map((d) => day(d, 8, 8));
    expect(pay(sessions, daily).overtimeMinutes).toBe(0);
  });

  it('no-overtime policy pays everything as regular', () => {
    const none = { ...S, dailyOvertimeEnabled: false, weeklyOvertimeEnabled: false };
    const r = pay([day('2027-01-04', 4, 14)], none);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.grossTotalCents).toBe(14 * 3000);
    expect(r.blocks[0]?.rule).toBe('Company policy: no overtime.');
  });

  it('excludes invalid sessions with a warning', () => {
    const bad: PayableSession = { id: 'x', start: '2027-01-04T15:00:00Z', end: '2027-01-04T14:00:00Z', breakMinutes: 0 };
    const r = pay([bad]);
    expect(r.workedMinutes).toBe(0);
    expect(r.warnings[0]?.code).toBe('SESSION_INVALID');
  });

  it('rounds money to the cent correctly', () => {
    const r = pay([day('2027-01-04', 8, 7.75)], S, 1733); // $17.33/h × 7.75h = $134.3075
    expect(r.grossTotalCents).toBe(13431);
  });
});

describe('policy validation (sanity bounds only, no legal rules)', () => {
  it('accepts defaults', () => expect(validatePayrollSettings(S)).toEqual([]));
  it('accepts any company choice, e.g. OT after 10 h/day, 50 h/week, 1.25×', () =>
    expect(validatePayrollSettings({ ...S, dailyThresholdMinutes: 600, weeklyThresholdMinutes: 3000, overtimeMultiplier: 1.25 })).toEqual([]));
  it('rejects a daily threshold over 24 h', () =>
    expect(validatePayrollSettings({ ...S, dailyThresholdMinutes: 1500 })[0]?.field).toBe('dailyThresholdMinutes'));
  it('rejects a weekly threshold over 168 h', () =>
    expect(validatePayrollSettings({ ...S, weeklyThresholdMinutes: 10081 })[0]?.field).toBe('weeklyThresholdMinutes'));
  it('rejects a multiplier below 1×', () =>
    expect(validatePayrollSettings({ ...S, overtimeMultiplier: 0.5 })[0]?.field).toBe('overtimeMultiplier'));
  it('rejects averaging over 52 weeks', () =>
    expect(validatePayrollSettings({ ...S, averaging: { enabled: true, periodWeeks: 60, anchorDate: '2027-01-03' } }).length).toBe(1));
  it('rejects unknown time zone', () =>
    expect(validatePayrollSettings({ ...S, timezone: 'Mars/Base' })[0]?.field).toBe('timezone'));
});

describe('pay period block attribution', () => {
  it('returns weeks ending within a biweekly period', () => {
    const b = blocksEndingInPeriod('2027-01-03', '2027-01-16', S);
    expect(b).toEqual([
      { start: '2027-01-03', end: '2027-01-09' },
      { start: '2027-01-10', end: '2027-01-16' },
    ]);
  });
  it('mid-week period end attributes the week to the period where it ends', () => {
    const b = blocksEndingInPeriod('2027-01-01', '2027-01-15', S);
    expect(b).toEqual([{ start: '2026-12-27', end: '2027-01-02' }, { start: '2027-01-03', end: '2027-01-09' }]);
  });
});
