/*
 * The team: the real people in the office, next to the agents working with them. It's the owner's
 * own picture of who sits where, what they're on, what they're good at and whether they're free.
 *
 * Who's on the team is never in the repository. It's kept in the office's own folder
 * (`.agent-office/team.json`, which git ignores), so this file only says what shape it has.
 * Anything not known stays empty or 'unknown' rather than being filled in with a guess.
 */

/** Whether someone can be interrupted: 'unknown' until something has said. */
export const AVAILABILITY = ['free', 'busy', 'away', 'unknown'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export interface AvailabilityInfo {
  state: Availability;
  /** Where it came from: their calendar's free/busy, or set by hand. */
  source?: 'calendar' | 'manual';
  /** When this was last checked (ms since the epoch). Too old, and it shows as unknown (see availabilityNow). */
  checkedAt?: number;
  /** When it changes next, if known (ms since the epoch). */
  until?: number;
}

export interface TeamMember {
  /** Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  role: string;
  /** Picks the character's look. Not shown anywhere. */
  look: 'man' | 'woman';
  /** Works from elsewhere: shown on the remote screen, not at a desk. */
  remote?: boolean;
  /** The one running this office: they walk about as themselves, so nobody stands in for them. */
  self?: boolean;
  /** Which of the people's desks they sit at (see PEOPLE_DESKS), or null while they have no desk yet. */
  desk: string | null;
  /** What they're on right now, in the owner's words. Empty when not known. */
  workingOn: string;
  /** What they're good at, in the owner's words. Empty when not known. */
  goodAt: string[];
  /** What the owner's files say about them, for context. Dated by whoever wrote it, not a live status. */
  fromFiles?: string;
  availability: AvailabilityInfo;
}

export interface TeamState {
  members: TeamMember[];
  /** When the calendar was last read for anyone (ms since the epoch). */
  calendarAt?: number;
  /** What's wrong with the file, if it won't load. */
  error?: string;
}

/** After this long without a check, a calendar's answer says nothing about now. */
export const AVAILABILITY_STALE_MS = 2 * 60 * 60_000;

/** What can be said about `a` at `now`: a calendar's answer that's gone stale, or run out, is 'unknown'. */
export function availabilityNow(a: AvailabilityInfo, now: number): Availability {
  if (a.source !== 'calendar') return a.state;
  if (a.checkedAt === undefined || now - a.checkedAt > AVAILABILITY_STALE_MS) return 'unknown';
  if (a.until !== undefined && now >= a.until) return 'unknown';
  return a.state;
}

/** How each state shows, on the light over someone's head and in the team window. */
export const AVAILABILITY_LOOK: Record<Availability, { color: string; label: string }> = {
  free: { color: '#35c46b', label: 'Free' },
  busy: { color: '#e5484d', label: 'Busy' },
  away: { color: '#e0a83a', label: 'Away' },
  unknown: { color: '#9aa0a6', label: 'Unknown' },
};

/** What the owner can change from the app. Availability isn't here: that's the calendar's to say. */
export interface TeamEdit {
  id: string;
  desk?: string | null;
  workingOn?: string;
  goodAt?: string[];
}
