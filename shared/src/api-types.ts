/** Response shapes returned by the Blue Collar API (/api/v1). */
import type { CompanyPermission, CompanyRole, PlatformPermission, PlatformRole } from './permissions';
import type { TimeEventType } from './schemas';

export interface ApiError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface MeMembership {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyStatus: 'active' | 'suspended';
  role: CompanyRole;
  permissions: CompanyPermission[];
  siteScope: string[] | null; // null = all sites
}

export interface Me {
  userId: string;
  email: string;
  fullName: string;
  locale: string;
  memberships: MeMembership[];
  platform: { role: PlatformRole; permissions: PlatformPermission[]; mfaVerified: boolean } | null;
}

export interface Company {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface Member {
  membershipId: string;
  userId: string | null;
  fullName: string;
  email: string;
  role: CompanyRole;
  status: 'active' | 'inactive' | 'invited';
  jobTitle: string | null;
  overtimeExempt: boolean;
  hourlyRate: string | null; // only when caller has payrates.view or it is their own record
  siteIds: string[];
  extraPermissions: string[];
  revokedPermissions: string[];
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  fullName: string;
  role: CompanyRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface JobSite {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geofenceRadiusM: number | null;
  notes: string | null;
  status: 'active' | 'archived';
  startsOn: string | null;
  endsOn: string | null;
}

export interface Shift {
  id: string;
  siteId: string;
  siteName: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  instructions: string | null;
  status: 'scheduled' | 'cancelled';
  version: number;
  assignees: { membershipId: string; fullName: string }[];
  updatedAt: string;
}

export interface TimeEvent {
  id: string;
  type: TimeEventType;
  occurredAt: string;
  deviceTime: string;
  serverReceivedAt: string;
  source: 'online' | 'offline';
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  distanceFromSiteM: number | null;
  flags: string[];
  reviewStatus: 'accepted' | 'needs_review';
}

export interface Adjustment {
  id: string;
  adjustedStart: string;
  adjustedEnd: string;
  adjustedBreakMinutes: number;
  reason: string;
  createdBy: { userId: string; fullName: string };
  createdAt: string;
  active: boolean;
}

export interface Dispute {
  id: string;
  sessionId: string;
  adjustmentId: string | null;
  explanation: string;
  status: 'open' | 'resolved' | 'rejected';
  resolutionNote: string | null;
  raisedBy: { membershipId: string; fullName: string };
  resolvedBy: { userId: string; fullName: string } | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface WorkSession {
  id: string;
  membershipId: string;
  employeeName: string;
  shiftId: string | null;
  siteName: string | null;
  originalStart: string;
  originalEnd: string | null;
  originalBreakMinutes: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  effectiveBreakMinutes: number;
  paidMinutes: number | null;
  status: 'open' | 'closed' | 'needs_review';
  approvalStatus: 'pending' | 'approved' | 'rejected';
  version: number;
  flags: string[];
  adjusted: boolean;
  openDisputes: number;
}

export interface WorkSessionDetail extends WorkSession {
  events: TimeEvent[];
  adjustments: Adjustment[];
  disputes: Dispute[];
}

export interface PayPeriod {
  id: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: 'open' | 'calculated' | 'approved' | 'paid';
  totals: { employees: number; regularMinutes: number; overtimeMinutes: number; grossCents: number };
}

export interface PayrollRecord {
  id: string;
  payPeriodId: string;
  membershipId: string;
  employeeName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  hourlyRateCents: number;
  overtimeMultiplier: number;
  grossRegularCents: number;
  grossOvertimeCents: number;
  grossTotalCents: number;
  status: 'draft' | 'approved' | 'paid';
  paidAt: string | null;
  trace: unknown;
  pendingSessions: number;
}

export interface Conversation {
  id: string;
  kind: 'direct' | 'group' | 'announcement';
  title: string | null;
  members: { membershipId: string; fullName: string }[];
  lastMessage: { body: string; createdAt: string; senderName: string } | null;
  unread: number;
  lastMessageAt: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderMembershipId: string;
  senderName: string;
  body: string;
  createdAt: string;
  readBy: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
