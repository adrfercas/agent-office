import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { rejected, settled } from './floorplan';
import { bindTeamUi, openPersonCard, openTeam, refreshTeamUi } from './ui';

/*
 * The team window (the agentix office's picture of the team, see shared/team.ts): U opens it from the
 * keyboard, and the ☰ menu has it. It follows the team as the server last said it and the workers on
 * this floor. The people in the room itself are features/team/world.ts and people.ts.
 */

/** Registers U, and keeps an open team window up to date. */
export function installTeam(ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  const { net } = ctx;
  bindTeamUi({
    net,
    plan: () => ctx.plan(),
    goTo: (id) => void parts.waiting.goToWorker(id),
    openTerminal: (id) => parts.waiting.openWorkerTerminal(id),
  });
  // Only the agentix office has a team to show.
  const here = () => ctx.plan().id === 'agentix';
  ctx.keys.bind({ code: 'KeyU', when: here, run: () => void openTeam() });
  store.on('people', () => {
    settled();
    refreshTeamUi();
  });
  // A refused change (it comes as a warning toast) sends the markers back and says why under the plan.
  ctx.messages.on('toast', (msg) => msg.level === 'warn' && rejected(msg.text));
  store.on('workers', refreshTeamUi);
  return { openTeam: () => (here() ? openTeam() : undefined), isHere: here, team: () => store.people, open: openPersonCard };
}
