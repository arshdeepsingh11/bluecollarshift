import { describe, expect, it } from 'vitest';
import {
  allowedNextEvents,
  canAssignRole,
  distanceMetres,
  effectiveCompanyPermissions,
  localDate,
  localStateFor,
  nextRetryDelayMs,
  shiftSchema,
  timeEventSchema,
} from '../src';

describe('permissions', () => {
  it('employees cannot be granted management permissions', () => {
    const p = effectiveCompanyPermissions('employee', ['payroll.manage', 'timesheets.adjust']);
    expect(p.has('payroll.manage')).toBe(false);
    expect(p.has('timesheets.adjust')).toBe(false);
  });
  it('owners cannot have permissions revoked', () => {
    expect(effectiveCompanyPermissions('owner', [], ['payroll.manage']).has('payroll.manage')).toBe(true);
  });
  it('supervisor defaults exclude payroll and pay rates', () => {
    const p = effectiveCompanyPermissions('supervisor');
    expect(p.has('payroll.view')).toBe(false);
    expect(p.has('payrates.view')).toBe(false);
  });
  it('role assignment cannot escalate', () => {
    expect(canAssignRole('manager', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'owner' as never)).toBe(false);
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('employee', 'employee')).toBe(false);
  });
  it('ignores unknown permission strings', () => {
    expect(effectiveCompanyPermissions('manager', ['root.everything']).has('root.everything' as never)).toBe(false);
  });
});

describe('sync helpers', () => {
  it('maps server results to local states', () => {
    expect(localStateFor({ id: 'a', result: 'accepted', sessionId: null, flags: [], serverReceivedAt: '' })).toBe('synced');
    expect(localStateFor({ id: 'a', result: 'rejected', reason: 'x' })).toBe('rejected');
    expect(localStateFor({ id: 'a', result: 'needs_review', sessionId: null, flags: ['x'], serverReceivedAt: '' })).toBe('needs_review');
  });
  it('backs off exponentially with a cap', () => {
    expect(nextRetryDelayMs(0, () => 0.5)).toBe(5000);
    expect(nextRetryDelayMs(1, () => 0.5)).toBe(15000);
    expect(nextRetryDelayMs(10, () => 0.5)).toBe(900000);
  });
  it('enforces clock state machine', () => {
    expect(allowedNextEvents(null)).toEqual(['clock_in']);
    expect(allowedNextEvents('clock_in')).toContain('clock_out');
    expect(allowedNextEvents('break_start')).toEqual(['break_end']);
  });
});

describe('validation', () => {
  it('rejects shifts ending before start', () => {
    const r = shiftSchema.safeParse({
      siteId: crypto.randomUUID(),
      startsAt: '2027-01-04T15:00:00Z',
      endsAt: '2027-01-04T14:00:00Z',
      membershipIds: [crypto.randomUUID()],
    });
    expect(r.success).toBe(false);
  });
  it('rejects out-of-range coordinates', () => {
    const r = timeEventSchema.safeParse({
      id: crypto.randomUUID(), type: 'clock_in', deviceTime: '2027-01-04T15:00:00Z', offline: false, lat: 120, lng: 0, deviceId: 'dev-1',
    });
    expect(r.success).toBe(false);
  });
});

describe('time helpers', () => {
  it('computes Edmonton local date across UTC midnight', () => {
    expect(localDate('2027-01-05T03:00:00Z', 'America/Edmonton')).toBe('2027-01-04');
  });
  it('computes distance', () => {
    // Calgary Tower to Calgary City Hall ≈ 700 m
    const d = distanceMetres(51.0442, -114.0631, 51.0453, -114.0571);
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(600);
  });
});
