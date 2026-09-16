/**
 * Who runs the league, and what each of them is allowed to settle.
 *
 * The roles are deliberately about jobs rather than permissions: the person who
 * registers players is not the person who rules on a red card, and the league
 * secretary is the only one who can do both.
 */

export const STAFF_ROLES = ['secretary', 'registrar', 'discipline', 'readonly'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What each role may do beyond reading. `secretary` is the only role that may run the league. */
export const ROLE_MAY_WRITE: Record<StaffRole, boolean> = {
  secretary: true,
  registrar: true,
  discipline: true,
  readonly: false,
};

/** The parts of the league each role may write to. A secretary writes everywhere. */
export const ROLE_SCOPES: Record<StaffRole, readonly string[]> = {
  secretary: ['registrations', 'fixtures', 'results', 'discipline', 'staff'],
  registrar: ['registrations'],
  discipline: ['discipline'],
  readonly: [],
};

export interface StaffRow {
  id: number;
  email: string;
  full_name: string;
  role: string;
  password: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: number;
  email: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  id: number;
  staff_id: number;
  token: string;
  issued_at: string;
  expires_at: string;
  ended_at: string | null;
}

export interface Session {
  id: number;
  staffId: number;
  token: string;
  issuedAt: string;
  expiresAt: string;
  endedAt: string | null;
}

/** How long a sign-in lasts before the holder has to sign in again. */
export const SESSION_HOURS = 12;

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: isStaffRole(row.role) ? row.role : 'readonly',
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    staffId: row.staff_id,
    token: row.token,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
  };
}
