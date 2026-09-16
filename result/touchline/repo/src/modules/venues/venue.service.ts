/**
 * Every rule about a venue that could be argued about.
 *
 * The one that bites downstream: a closed venue keeps its fixtures already in
 * the book but takes no new ones, so closing is a state rather than a delete.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { requireRealDay } from '../../lib/days';
import { VenueRepository, type VenueFilter } from './venue.repository';
import { dailyCapacity, type Surface, type Venue } from './venue.types';

export interface CreateVenue {
  name: string;
  addressLine: string;
  postcode: string;
  surface: Surface;
  pitchCount: number;
  floodlit: boolean;
}

export class VenueService {
  constructor(private readonly repo: VenueRepository) {}

  create(input: CreateVenue): Venue {
    if (this.repo.byNameAndPostcode(input.name, input.postcode) !== undefined) {
      throw new ConflictError('That ground is already on the list at that postcode', {
        name: input.name,
        postcode: input.postcode,
      });
    }
    return this.repo.insert(input);
  }

  get(venueId: number): Venue {
    const venue = this.repo.byId(venueId);
    if (venue === undefined) throw new NotFoundError(`There is no venue ${venueId}`);
    return venue;
  }

  list(filter: VenueFilter): Venue[] {
    return this.repo.list(filter);
  }

  update(
    venueId: number,
    changes: {
      name?: string;
      addressLine?: string;
      surface?: Surface;
      pitchCount?: number;
      floodlit?: boolean;
    },
  ): Venue {
    const venue = this.get(venueId);
    if (venue.status === 'closed') {
      throw new ConflictError('A closed ground cannot be changed', { venueId });
    }
    if (changes.name !== undefined) {
      const other = this.repo.byNameAndPostcode(changes.name, venue.postcode);
      if (other !== undefined && other.id !== venueId) {
        throw new ConflictError('That ground is already on the list at that postcode', {
          name: changes.name,
          postcode: venue.postcode,
        });
      }
    }
    return this.repo.update(venueId, changes);
  }

  close(venueId: number, closedOn: string): Venue {
    const venue = this.get(venueId);
    if (venue.status === 'closed') {
      throw new ConflictError('That ground is already closed', { venueId });
    }
    return this.repo.update(venueId, {
      status: 'closed',
      closedOn: requireRealDay(closedOn, 'closedOn'),
    });
  }

  reopen(venueId: number): Venue {
    const venue = this.get(venueId);
    if (venue.status === 'open') {
      throw new ConflictError('That ground is already open', { venueId });
    }
    return this.repo.update(venueId, { status: 'open', closedOn: null });
  }

  /** Fixtures ask this before putting another game on a ground on a given day. */
  requireOpen(venueId: number): Venue {
    const venue = this.get(venueId);
    if (venue.status !== 'open') {
      throw new ConflictError(`Venue ${venueId} is closed`, { venueId });
    }
    return venue;
  }

  /** How many games this ground will take on one day, from its surface and its pitches. */
  capacityOn(venueId: number): number {
    return dailyCapacity(this.get(venueId));
  }
}
