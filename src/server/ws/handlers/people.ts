// The team (shared/team.ts): reading it, and the owner's changes to desks and notes.
import type { PeopleClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const peopleHandlers = {
  'people.get'(ctx, c) {
    ctx.roster.refresh();
    ctx.sendTo(c, { t: 'people', state: ctx.roster.state() });
  },
  'people.edit'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the team');
    ctx.warn(c, ctx.roster.edit(msg.edit));
  },
} satisfies HandlerMap<PeopleClientMsg>;
