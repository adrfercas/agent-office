import { chatLink } from '../../../shared/chat-link';
import type { TeamMember } from '../../../shared/team';
import { h } from '../../ui/dom';

// "Talk" on a colleague's card: it takes you to your direct chat with them in Google Chat. That chat's
// address can't be worked out from a name or an email address, so it is copied once from Google Chat and
// kept in the team file. Nothing is sent from here, and no message is pretended.

/** People whose link box is open to change a link they already have. (Without a link, the box is always open.) */
const changing = new Set<string>();

/** What the card needs to keep a link: saves it through `people.edit`, and redraws the card. */
export interface TalkHost {
  save(id: string, chat: string | null): void;
  redraw(): void;
}

/**
 * The Talk part of a person's card, or null for the person running the office. With a saved link it is
 * a plain link that opens in a new tab or window, so the click itself opens it (nothing is blocked as a
 * pop-up) and, where the browser sends such links to the installed Google Chat app, it opens there.
 * `noopener` keeps the new page from reaching back into the office. Without one, it asks for the link.
 */
export function talkSection(m: TeamMember, host: TalkHost, compact = false): HTMLElement | null {
  if (m.self) return null;
  // The link is checked again here: it came from a file, and a click will open it.
  const saved = m.chat === undefined ? null : chatLink(m.chat);
  const url = saved && 'url' in saved ? saved.url : null;
  const showBox = !url || changing.has(m.id);
  const kids: (Node | null)[] = [];
  if (url) {
    kids.push(
      h('a.btn.primary.tw-talk-btn', { href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Talk to ${m.name} in Google Chat` }, 'Talk'),
      h('button.btn.tw-talk-edit', {
        type: 'button',
        onclick: () => {
          if (changing.has(m.id)) changing.delete(m.id);
          else changing.add(m.id);
          host.redraw();
        },
      }, showBox ? 'Cancel' : 'Change link'),
    );
  }
  if (showBox) kids.push(linkBox(m, host));
  return h('div.tw-talk', { class: compact ? 'compact' : '' }, ...kids);
}

/** The box to paste the link into, with where to copy it from, and its mistakes said in place. */
function linkBox(m: TeamMember, host: TalkHost): HTMLElement {
  const input = h('input', { type: 'text', placeholder: 'Paste the chat link', 'aria-label': `Google Chat link for ${m.name}`, autocomplete: 'off', spellcheck: 'false' });
  const problem = h('p.tw-talk-problem', { role: 'alert' });
  const save = () => {
    const link = chatLink(input.value);
    if ('error' in link) return void (problem.textContent = link.error);
    problem.textContent = '';
    changing.delete(m.id);
    host.save(m.id, link.url);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), save()));
  return h(
    'div.tw-talk-box',
    {},
    h('p.tw-talk-help', {}, `To talk to ${m.name}: open your chat with them in Google Chat in the browser, copy the address from the address bar, and paste it here. It is kept in the team file.`),
    h('div.tw-talk-paste', {}, input, h('button.btn', { type: 'button', onclick: save }, 'Save link')),
    problem,
  );
}
