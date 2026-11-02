/*
 * The link that takes someone to a colleague's chat in Google Chat. It's opened by a click, so
 * what's allowed is kept narrow: a plain https link on one of Google Chat's own hosts, and nothing
 * else. Both the server (when it reads or changes the team file) and the page (before it shows a
 * link or sends one) use this, so the two can't disagree.
 */

/**
 * The hosts a chat link may be on, matched whole (never as part of a longer name). Google Chat's own
 * address is chat.google.com. Chat inside Gmail is on mail.google.com, which is where the one link
 * shape found for a direct chat points (mail.google.com/chat/u/0/#chat/dm/<id>, see docs/team.md).
 */
export const CHAT_HOSTS: readonly string[] = ['chat.google.com', 'mail.google.com'];

/** The longest link kept. Real ones are far shorter. */
export const MAX_CHAT_LINK = 500;

export type ChatLinkResult = { url: string } | { error: string };

/** The tidy form of a chat link, or why it can't be used. The returned `url` is what to keep and open, not the text that came in. */
export function chatLink(v: unknown): ChatLinkResult {
  if (typeof v !== 'string') return { error: 'The chat link should be text' };
  const text = v.trim();
  if (!text) return { error: 'The chat link is empty' };
  if (text.length > MAX_CHAT_LINK) return { error: `The chat link is longer than ${MAX_CHAT_LINK} characters` };
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return { error: 'The chat link has spaces or hidden characters in it' };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: 'That doesn’t look like a link. Copy the whole address from the browser, starting with https://' };
  }
  if (u.protocol !== 'https:') return { error: 'The chat link has to start with https://' };
  if (u.username || u.password || u.port) return { error: 'The chat link can’t carry a login or a port' };
  if (!CHAT_HOSTS.includes(u.hostname)) return { error: `The chat link has to be on ${CHAT_HOSTS.join(' or ')}` };
  return { url: u.href };
}
