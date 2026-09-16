/**
 * Who may sign in, for how long, and who may change a colleague's role.
 *
 * A wrong password and an unknown email answer the same way on purpose: a
 * caller guessing at addresses learns nothing from the difference.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ConflictError, NotFoundError, UnauthorisedError } from '../../lib/AppError';
import { AuthRepository, type StaffFilter } from './auth.repository';
import { SESSION_HOURS, type Session, type Staff, type StaffRole } from './auth.types';

const SCRYPT_KEY_BYTES = 32;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, SCRYPT_KEY_BYTES).toString('hex');
  return `${salt}:${derived}`;
}

export function passwordMatches(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  const salt = parts[0];
  const expected = parts[1];
  if (salt === undefined || expected === undefined) return false;
  const derived = scryptSync(plain, salt, SCRYPT_KEY_BYTES);
  const known = Buffer.from(expected, 'hex');
  if (known.length !== derived.length) return false;
  return timingSafeEqual(known, derived);
}

export interface SignedIn {
  token: string;
  staffId: number;
  role: StaffRole;
  issuedAt: string;
  expiresAt: string;
}

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  createStaff(input: {
    email: string;
    fullName: string;
    role: StaffRole;
    password: string;
  }): Staff {
    const email = input.email.toLowerCase();
    if (this.repo.staffByEmail(email) !== undefined) {
      throw new ConflictError('That email address already belongs to somebody', { email });
    }
    return this.repo.insertStaff({
      email,
      fullName: input.fullName,
      role: input.role,
      password: hashPassword(input.password),
    });
  }

  getStaff(staffId: number): Staff {
    const staff = this.repo.staffById(staffId);
    if (staff === undefined) throw new NotFoundError(`There is no staff member ${staffId}`);
    return staff;
  }

  listStaff(filter: StaffFilter): Staff[] {
    return this.repo.listStaff(filter);
  }

  updateStaff(
    staffId: number,
    changes: { fullName?: string; role?: StaffRole; active?: boolean },
  ): Staff {
    const staff = this.getStaff(staffId);
    // The league cannot be left without anybody able to run it.
    if (staff.role === 'secretary' && (changes.role !== undefined || changes.active === false)) {
      const secretaries = this.repo
        .listStaff({ role: 'secretary', active: true })
        .filter((other) => other.id !== staff.id);
      if (secretaries.length === 0) {
        throw new ConflictError('The league would be left without an active secretary', {
          staffId,
        });
      }
    }
    return this.repo.updateStaff(staffId, changes);
  }

  signIn(email: string, password: string, at: Date = new Date()): SignedIn {
    const staff = this.repo.staffByEmail(email.toLowerCase());
    const stored = staff ? this.repo.passwordFor(staff.id) : undefined;
    if (staff === undefined || stored === undefined || !passwordMatches(password, stored)) {
      throw new UnauthorisedError('That email address and password do not go together');
    }
    if (!staff.active) {
      throw new UnauthorisedError('That account is no longer active');
    }
    const token = randomBytes(24).toString('hex');
    const issuedAt = at.toISOString();
    const expiresAt = new Date(at.getTime() + SESSION_HOURS * 3_600_000).toISOString();
    const session = this.repo.insertSession(staff.id, token, issuedAt, expiresAt);
    return {
      token: session.token,
      staffId: staff.id,
      role: staff.role,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  /** The staff member behind a bearer token, or a refusal. */
  staffForToken(token: string, at: Date = new Date()): Staff {
    const session = this.repo.sessionByToken(token);
    if (session === undefined) throw new UnauthorisedError('That session is not one of ours');
    if (session.endedAt !== null) throw new UnauthorisedError('That session has been signed out');
    if (Date.parse(session.expiresAt) <= at.getTime()) {
      throw new UnauthorisedError('That session has expired');
    }
    const staff = this.repo.staffById(session.staffId);
    if (staff === undefined || !staff.active) {
      throw new UnauthorisedError('That account is no longer active');
    }
    return staff;
  }

  signOut(token: string, at: Date = new Date()): Session {
    const session = this.repo.sessionByToken(token);
    if (session === undefined) throw new UnauthorisedError('That session is not one of ours');
    if (session.endedAt === null) this.repo.endSession(session.id, at.toISOString());
    return this.repo.sessionById(session.id) as Session;
  }
}
