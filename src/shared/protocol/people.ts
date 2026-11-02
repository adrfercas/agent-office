// The team: the people of the office, and the agents working with them (see shared/team.ts). It's
// "people" on the wire because "team" is already the SSH invites (protocol/accounts.ts).

import type { TeamEdit, TeamState } from '../team.js';

export type PeopleClientMsg =
  /** Read the team file again and send it, even if nothing seems to have changed. */
  | { t: 'people.get' }
  /** Change one person (admins only): their desk, what they're on, what they're good at. */
  | { t: 'people.edit'; edit: TeamEdit };

export type PeopleServerMsg =
  /** The team, as the file says: after you arrive, and whenever it changes (from the app or on disk). */
  { t: 'people'; state: TeamState };
