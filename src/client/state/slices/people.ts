import type { TeamState } from '../../../shared/team';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The team: the people of the office, as .agent-office/team.json says (see shared/team.ts). Not `team`, which is the SSH invites. */
    people: TeamState;
  }
  interface Topics {
    people: true;
  }
}

export const people: Slice = {
  init(s) {
    s.people = { members: [] };
  },
  on: {
    people(s, m) {
      s.people = m.state;
      return ['people'];
    },
  },
};
