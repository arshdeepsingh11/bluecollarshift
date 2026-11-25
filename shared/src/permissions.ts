/**
 * Permission catalogue — single source of truth for web, server and mobile.
 *
 * Two completely separate administration levels:
 *  - Company roles (owner … employee) act ONLY inside their own company.
 *  - Platform roles (Blue Collar staff) manage the SaaS platform and get NO
 *    automatic access to company payroll, hours or conversations.
 *
 * The UI may use these to hide controls, but the server is the authority
 * (Rules.md, Rule 1). Never trust a role or permission sent by a client.
 */

export const COMPANY_ROLES = ['owner', 'admin', 'manager', 'supervisor', 'payroll', 'employee'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PLATFORM_ROLES = [
  'super_admin',
  'platform_admin',
  'support',
  'operations',
  'billing',
  'auditor',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const COMPANY_PERMISSIONS = [
  'company.settings.manage',
  'members.view',
  'members.invite',
  'members.manage',
  'roles.manage',
  'payrates.view',
  'payrates.manage',
  'sites.view',
  'sites.manage',
  'shifts.view',
  'shifts.manage',
  'attendance.view',
  'attendance.review',
  'timesheets.adjust',
  'timesheets.approve',
  'disputes.resolve',
  'payroll.view',
  'payroll.manage',
  'messages.send',
  'announcements.send',
  'reports.view',
  'audit.view',
] as const;
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.overview.view',
  'platform.companies.view',
  'platform.companies.manage',
  'platform.staff.view',
  'platform.staff.manage',
  'platform.audit.view',
  'platform.security.view',
  'platform.settings.manage',
  'platform.support_access.request',
  'platform.billing.view',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const ALL_COMPANY = [...COMPANY_PERMISSIONS];

/** Default permissions per company role. Owners can grant extra permissions per member. */
export const DEFAULT_COMPANY_PERMISSIONS: Record<CompanyRole, readonly CompanyPermission[]> = {
  owner: ALL_COMPANY,
  admin: ALL_COMPANY.filter((p) => p !== 'roles.manage'),
  manager: [
    'members.view',
    'members.invite',
    'sites.view',
    'sites.manage',
    'shifts.view',
    'shifts.manage',
    'attendance.view',
    'attendance.review',
    'timesheets.adjust',
    'timesheets.approve',
    'disputes.resolve',
    'messages.send',
    'announcements.send',
    'reports.view',
  ],
  supervisor: [
    'members.view',
    'sites.view',
    'shifts.view',
    'shifts.manage',
    'attendance.view',
    'attendance.review',
    'messages.send',
  ],
  payroll: [
    'members.view',
    'payrates.view',
    'attendance.view',
    'payroll.view',
    'payroll.manage',
    'reports.view',
    'messages.send',
  ],
  employee: ['messages.send'],
};

/** Roles whose access is limited to assigned job sites when site scopes exist. */
export const SITE_SCOPED_ROLES: readonly CompanyRole[] = ['manager', 'supervisor'];

/** Supervisors are ALWAYS site-scoped (no scopes = no sites). Managers only if scopes are set. */
export function isAlwaysSiteScoped(role: CompanyRole): boolean {
  return role === 'supervisor';
}

export const DEFAULT_PLATFORM_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  super_admin: [...PLATFORM_PERMISSIONS],
  platform_admin: [
    'platform.overview.view',
    'platform.companies.view',
    'platform.companies.manage',
    'platform.staff.view',
    'platform.audit.view',
    'platform.security.view',
    'platform.support_access.request',
  ],
  support: ['platform.overview.view', 'platform.companies.view', 'platform.support_access.request'],
  operations: ['platform.overview.view', 'platform.security.view', 'platform.audit.view'],
  billing: ['platform.overview.view', 'platform.companies.view', 'platform.billing.view'],
  auditor: ['platform.overview.view', 'platform.audit.view', 'platform.security.view', 'platform.companies.view'],
};

/** Which company roles a given role may assign to others (prevents privilege escalation). */
export const ASSIGNABLE_ROLES: Record<CompanyRole, readonly CompanyRole[]> = {
  owner: ['admin', 'manager', 'supervisor', 'payroll', 'employee'],
  admin: ['manager', 'supervisor', 'payroll', 'employee'],
  manager: ['employee'],
  supervisor: [],
  payroll: [],
  employee: [],
};

export function effectiveCompanyPermissions(
  role: CompanyRole,
  granted: readonly string[] = [],
  revoked: readonly string[] = [],
): Set<CompanyPermission> {
  const set = new Set<CompanyPermission>(DEFAULT_COMPANY_PERMISSIONS[role]);
  // Owners/admins cannot be reduced below defaults; employees cannot be granted management permissions.
  if (role !== 'employee') {
    for (const p of granted) if (isCompanyPermission(p)) set.add(p);
  }
  if (role !== 'owner') {
    for (const p of revoked) if (isCompanyPermission(p)) set.delete(p);
  }
  return set;
}

export function isCompanyPermission(p: string): p is CompanyPermission {
  return (COMPANY_PERMISSIONS as readonly string[]).includes(p);
}

export function isCompanyRole(r: string): r is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(r);
}

export function isPlatformRole(r: string): r is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(r);
}

export function canAssignRole(actor: CompanyRole, target: CompanyRole): boolean {
  return ASSIGNABLE_ROLES[actor].includes(target);
}

/** Roles that manage a company (anything except plain employee). */
export function isStaffRole(role: CompanyRole): boolean {
  return role !== 'employee';
}
