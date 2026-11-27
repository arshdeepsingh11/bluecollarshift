/**
 * API contracts — validation schemas shared by server (authoritative) and clients (UX).
 * The server ALWAYS re-validates; client validation is only for faster feedback.
 */
import { z } from 'zod';
import { COMPANY_PERMISSIONS, COMPANY_ROLES, PLATFORM_ROLES } from './permissions';
import { COUNTRIES, CURRENCIES, RULE_PROFILE_IDS } from './payroll/rules';

export const uuid = z.string().uuid();
const isoInstant = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const email = z.string().trim().toLowerCase().email().max(254);
const money = z.number().finite().min(0).max(10_000);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

// ---------- Companies & onboarding ----------
export const registerCompanySchema = z.object({
  companyName: trimmed(2, 120),
  fullName: trimmed(2, 120),
  timezone: z.string().max(64).default('America/Toronto'),
  phone: z.string().trim().max(32).optional(),
  currency: z.enum(CURRENCIES).default('CAD'),
  country: z.enum(COUNTRIES).default('CA'),
});

export const updateCompanySchema = z.object({
  name: trimmed(2, 120).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  timezone: z.string().max(64).optional(),
  currency: z.enum(CURRENCIES).optional(),
  country: z.enum(COUNTRIES).optional(),
});

export const payrollSettingsSchema = z.object({
  ruleProfile: z.enum(RULE_PROFILE_IDS),
  timezone: z.string().max(64),
  workWeekStartDow: z.number().int().min(0).max(6),
  dailyOvertimeEnabled: z.boolean(),
  dailyThresholdMinutes: z.number().int().min(60).max(1440),
  weeklyOvertimeEnabled: z.boolean(),
  weeklyThresholdMinutes: z.number().int().min(60).max(10080),
  overtimeMultiplier: z.number().min(1).max(5),
  paidBreaks: z.boolean(),
  averaging: z
    .object({ enabled: z.boolean(), periodWeeks: z.number().int().min(1).max(52), anchorDate: isoDate })
    .nullable(),
  overtimeAgreementBanking: z.boolean(),
  payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']),
  payPeriodAnchor: isoDate,
  adpCompanyCode: z.string().trim().regex(/^[A-Za-z0-9]{2,3}$/, 'ADP company code is 2–3 letters or digits').nullable().optional(),
});

// ---------- Members & invitations ----------
export const inviteSchema = z.object({
  email,
  fullName: trimmed(2, 120),
  role: z.enum(COMPANY_ROLES).refine((r) => r !== 'owner', 'Owner cannot be invited'),
  hourlyRate: money.optional(),
  siteIds: z.array(uuid).max(200).default([]),
  /** Language of the invitation email and the person's starting language. */
  locale: z.enum(['en', 'es-MX', 'fr-CA', 'pa', 'hi', 'gu']).optional(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(32).max(128),
  fullName: trimmed(2, 120).optional(),
});

export const updateMemberSchema = z.object({
  role: z.enum(COMPANY_ROLES).optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  overtimeExempt: z.boolean().optional(),
  extraPermissions: z.array(z.enum(COMPANY_PERMISSIONS)).max(COMPANY_PERMISSIONS.length).optional(),
  revokedPermissions: z.array(z.enum(COMPANY_PERMISSIONS)).max(COMPANY_PERMISSIONS.length).optional(),
  siteIds: z.array(uuid).max(200).optional(),
  payrollId: z.string().trim().min(1).max(32).nullable().optional(),
  crewLead: z.boolean().optional(),
});

export const payRateSchema = z.object({
  hourlyRate: money,
  effectiveFrom: isoDate,
});

// ---------- Job sites ----------
export const siteSchema = z.object({
  name: trimmed(2, 120),
  address: z.string().trim().max(300).nullable().optional(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  geofenceRadiusM: z.number().int().min(25).max(5000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  startsOn: isoDate.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
});
export const updateSiteSchema = siteSchema.partial().extend({ status: z.enum(['active', 'archived']).optional() });

// ---------- Shifts ----------
export const shiftSchema = z
  .object({
    siteId: uuid,
    startsAt: isoInstant,
    endsAt: isoInstant,
    breakMinutes: z.number().int().min(0).max(240).default(0),
    instructions: z.string().trim().max(2000).nullable().optional(),
    membershipIds: z.array(uuid).max(200).default([]),
    openSlots: z.number().int().min(0).max(50).default(0),
    repeatWeeks: z.number().int().min(0).max(12).default(0),
  })
  .refine((s) => s.membershipIds.length + s.openSlots >= 1, 'Assign someone or add at least one open spot')
  .refine((s) => Date.parse(s.endsAt) > Date.parse(s.startsAt), 'Shift must end after it starts')
  .refine((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt) <= 24 * 3600_000, 'Shift cannot exceed 24 hours');

export const updateShiftSchema = z.object({
  version: z.number().int().min(1),
  siteId: uuid.optional(),
  startsAt: isoInstant.optional(),
  endsAt: isoInstant.optional(),
  breakMinutes: z.number().int().min(0).max(240).optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  membershipIds: z.array(uuid).max(200).optional(),
  openSlots: z.number().int().min(0).max(50).optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
});

// ---------- Attendance ----------
export const TIME_EVENT_TYPES = ['clock_in', 'clock_out', 'break_start', 'break_end'] as const;
export type TimeEventType = (typeof TIME_EVENT_TYPES)[number];

export const timeEventSchema = z.object({
  id: uuid, // generated on the device — idempotency key
  type: z.enum(TIME_EVENT_TYPES),
  shiftId: uuid.nullable().optional(),
  deviceTime: isoInstant,
  offline: z.boolean(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  deviceId: z.string().trim().min(4).max(128),
});

export const syncBatchSchema = z.object({
  events: z.array(timeEventSchema).min(1).max(200),
});

/** Crew clock-in: a lead records the same event for several crew members (one id per member). */
export const crewEventSchema = z.object({
  type: z.enum(TIME_EVENT_TYPES),
  shiftId: uuid.nullable().optional(),
  deviceTime: isoInstant,
  offline: z.boolean(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  deviceId: z.string().trim().min(4).max(128),
  entries: z.array(z.object({ id: uuid, membershipId: uuid })).min(1).max(50),
});

// ---------- Shift requests, time off, availability ----------
export const shiftRequestSchema = z
  .object({
    shiftId: uuid,
    kind: z.enum(['pickup', 'drop', 'swap']),
    targetMembershipId: uuid.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((r) => (r.kind === 'swap') === !!r.targetMembershipId, 'Choose a coworker for a swap (and only for a swap)');

export const decideRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).nullable().optional(),
});

export const peerResponseSchema = z.object({ accept: z.boolean() });

export const timeOffSchema = z
  .object({
    kind: z.enum(['vacation', 'sick', 'personal', 'unpaid', 'other']),
    startsOn: isoDate,
    endsOn: isoDate,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((r) => r.endsOn >= r.startsOn, 'End date must be on or after the start date');

export const availabilitySchema = z.object({
  days: z
    .array(
      z
        .object({
          dow: z.number().int().min(0).max(6),
          available: z.boolean(),
          startMinute: z.number().int().min(0).max(1440).nullable().optional(),
          endMinute: z.number().int().min(0).max(1440).nullable().optional(),
        })
        .refine((d) => !d.available || d.startMinute == null || (d.endMinute != null && d.endMinute > d.startMinute), 'End time must be after start time'),
    )
    .max(7),
});

// ---------- Safety ----------
export const safetyReportSchema = z.object({
  kind: z.enum(['incident', 'near_miss', 'hazard']),
  siteId: uuid.nullable().optional(),
  occurredAt: isoInstant,
  description: trimmed(5, 4000),
  injured: z.boolean().default(false),
  injuryDetails: z.string().trim().max(2000).nullable().optional(),
  actionTaken: z.string().trim().max(2000).nullable().optional(),
  photo: z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), size: z.number().int().min(1).max(5_242_880) }).nullable().optional(),
});
export const closeSafetySchema = z.object({ note: trimmed(3, 2000) });

export const toolboxTalkSchema = z.object({
  topic: trimmed(3, 200),
  notes: z.string().trim().max(4000).nullable().optional(),
  siteId: uuid.nullable().optional(),
  heldAt: isoInstant,
  attendeeIds: z.array(uuid).min(1).max(200),
});

// ---------- Feedback ----------
export const AUDIO_TYPES = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'] as const;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const feedbackSchema = z
  .object({
    kind: z.enum(['improvement', 'complaint', 'bug']),
    message: z.string().trim().max(4000).nullable().optional(),
    companyId: uuid.nullable().optional(),
    platform: z.enum(['web', 'ios', 'android']),
    appVersion: z.string().trim().max(40).nullable().optional(),
    audio: z.object({ contentType: z.enum(AUDIO_TYPES), size: z.number().int().min(1).max(5_242_880), seconds: z.number().min(0).max(125) }).nullable().optional(),
    screenshot: z.object({ contentType: z.enum(IMAGE_TYPES), size: z.number().int().min(1).max(5_242_880) }).nullable().optional(),
  })
  .refine((f) => (f.message && f.message.length >= 3) || f.audio, 'Type a message or record a voice note');

export const feedbackStatusSchema = z.object({
  status: z.enum(['new', 'planned', 'done', 'closed']),
  adminNote: z.string().trim().max(2000).nullable().optional(),
});

export const PAYROLL_EXPORT_FORMATS = ['generic', 'adp', 'gusto', 'quickbooks', 'wagepoint'] as const;
export type PayrollExportFormat = (typeof PAYROLL_EXPORT_FORMATS)[number];

/** Languages offered in the apps. */
export const LOCALES = ['en', 'es-MX', 'fr-CA', 'pa', 'hi', 'gu'] as const;
export type AppLocale = (typeof LOCALES)[number];

// ---------- Timesheets ----------
export const adjustmentSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    adjustedStart: isoInstant,
    adjustedEnd: isoInstant,
    adjustedBreakMinutes: z.number().int().min(0).max(600),
    reason: trimmed(5, 1000),
  })
  .refine((a) => Date.parse(a.adjustedEnd) > Date.parse(a.adjustedStart), 'End must be after start');

export const disputeSchema = z.object({
  adjustmentId: uuid.nullable().optional(),
  explanation: trimmed(5, 2000),
});

export const resolveDisputeSchema = z.object({
  status: z.enum(['resolved', 'rejected']),
  resolutionNote: trimmed(5, 2000),
});

export const approveSessionsSchema = z.object({
  sessionIds: z.array(uuid).min(1).max(500),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});

export const timesheetQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  membershipId: uuid.optional(),
  siteId: uuid.optional(),
  status: z.enum(['open', 'closed', 'needs_review']).optional(),
  approval: z.enum(['pending', 'approved', 'rejected']).optional(),
});

// ---------- Payroll ----------
export const payPeriodSchema = z.object({ startsOn: isoDate, endsOn: isoDate, payDate: isoDate });

// ---------- Messaging ----------
export const createConversationSchema = z.object({
  kind: z.enum(['direct', 'group', 'announcement']),
  title: z.string().trim().max(120).nullable().optional(),
  memberIds: z.array(uuid).min(1).max(500),
});

export const sendMessageSchema = z.object({
  id: uuid, // client-generated for idempotent offline retries
  body: trimmed(1, 4000),
  clientCreatedAt: isoInstant.optional(),
});

export const markReadSchema = z.object({ messageId: uuid });

// ---------- Notifications / devices ----------
export const deviceTokenSchema = z.object({
  token: z.string().trim().regex(/^ExponentPushToken\[[A-Za-z0-9_-]+\]$|^ExpoPushToken\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(['ios', 'android']),
});

// ---------- Platform administration ----------
export const inviteStaffSchema = z.object({ email, fullName: trimmed(2, 120), role: z.enum(PLATFORM_ROLES) });
export const companyStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: trimmed(5, 500),
});
export const supportAccessSchema = z.object({
  companyId: uuid,
  reason: trimmed(10, 500),
  minutes: z.number().int().min(15).max(240),
});

export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type SiteInput = z.infer<typeof siteSchema>;
export type ShiftInput = z.infer<typeof shiftSchema>;
export type TimeEventInput = z.infer<typeof timeEventSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
