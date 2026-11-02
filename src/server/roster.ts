import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PEOPLE_DESKS } from '../shared/maps/agentix.js';
import { AVAILABILITY, type AvailabilityInfo, type TeamMember, type TeamState } from '../shared/team.js';

/** The biggest team file read, the most people in it, and how often the file is looked at for a change. */
const MAX_BYTES = 256 * 1024;
const MAX_MEMBERS = 100;
const WATCH_MS = 2000;
const MAX_GOOD_AT = 20;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DESK_IDS = new Set(PEOPLE_DESKS.map((d) => d.id));

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** A trimmed string of at most `max` characters, or undefined if `v` isn't a string. */
function text(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined;
}

/** A finite number of milliseconds, or undefined. */
function ms(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function availabilityOf(v: unknown): AvailabilityInfo {
  if (!isObj(v)) return { state: 'unknown' };
  const state = (AVAILABILITY as readonly unknown[]).includes(v.state) ? (v.state as AvailabilityInfo['state']) : 'unknown';
  const source = v.source === 'calendar' || v.source === 'manual' ? v.source : undefined;
  const checkedAt = ms(v.checkedAt);
  const until = ms(v.until);
  return { state, ...(source ? { source } : {}), ...(checkedAt !== undefined ? { checkedAt } : {}), ...(until !== undefined ? { until } : {}) };
}

/** A list of short strings, cleaned: no blanks, no repeats, not too many. */
function goodAtOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = text(x, 80);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_GOOD_AT) break;
  }
  return out;
}

/** What the file says about the team, checked: nothing in it is taken on trust. Whatever can't be used is left out and said in `problems`. */
export function readTeam(json: unknown): { state: TeamState; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(json) || !Array.isArray(json.members)) return { state: { members: [] }, problems: ['the file should be { "members": [ … ] }'] };
  const list = json.members.slice(0, MAX_MEMBERS);
  if (json.members.length > MAX_MEMBERS) problems.push(`only the first ${MAX_MEMBERS} people are read`);
  const members: TeamMember[] = [];
  const desks = new Map<string, string>();
  list.forEach((m, i) => {
    const what = `members[${i}]`;
    if (!isObj(m)) return void problems.push(`${what} should be an object`);
    if (typeof m.id !== 'string' || !ID.test(m.id)) return void problems.push(`${what} needs an id of lowercase letters, digits and dashes`);
    if (members.some((x) => x.id === m.id)) return void problems.push(`${what}: the id "${m.id}" is there twice`);
    const name = text(m.name, 80);
    if (!name) return void problems.push(`${what} (${m.id}) needs a name`);
    let desk: string | null = null;
    if (typeof m.desk === 'string') {
      if (!DESK_IDS.has(m.desk)) problems.push(`${what} (${m.id}) has a desk "${m.desk}", and this office has no such desk`);
      else if (desks.has(m.desk)) problems.push(`${what} (${m.id}) shares the desk "${m.desk}" with ${desks.get(m.desk)}`);
      else {
        desk = m.desk;
        desks.set(m.desk, m.id);
      }
    }
    const fromFiles = text(m.fromFiles, 1000);
    members.push({
      id: m.id,
      name,
      role: text(m.role, 80) ?? '',
      look: m.look === 'woman' ? 'woman' : 'man',
      ...(m.remote === true ? { remote: true } : {}),
      ...(m.self === true ? { self: true } : {}),
      desk: m.remote === true ? null : desk,
      workingOn: text(m.workingOn, 300) ?? '',
      goodAt: goodAtOf(m.goodAt),
      ...(fromFiles ? { fromFiles } : {}),
      availability: availabilityOf(m.availability),
    });
  });
  const calendarAt = ms(json.calendarAt);
  return { state: { members, ...(calendarAt !== undefined ? { calendarAt } : {}) }, problems };
}

/**
 * The team: the people of the office, kept in `<dataDir>/team.json` (which git ignores: who they are
 * never goes in the repository). The owner edits desks, what they're on and what they're good at in
 * the app; a separate step (the calendar's) writes `availability`. The file is looked at again every
 * couple of seconds and whenever someone arrives, so an edit on disk shows without a restart. A file
 * that's missing is an empty team; one that won't load keeps the last good team and says what's wrong.
 */
export class Roster {
  private file: string;
  private current: TeamState = { members: [] };
  /** What the file looked like when it was last read: its size and mtime. */
  private stamp = '';
  private timer?: NodeJS.Timeout;

  constructor(
    dataDir: string,
    private onState: (state: TeamState) => void,
  ) {
    this.file = path.join(dataDir, 'team.json');
    this.look();
  }

  state(): TeamState {
    return this.current;
  }

  /** Watches the file for changes made outside the app. */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh(), WATCH_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reads the file again if it changed on disk, and tells everyone if so. True if the team changed. */
  refresh(): boolean {
    if (!this.look()) return false;
    this.onState(this.current);
    return true;
  }

  /**
   * Applies one change from the app and writes the file. Returns why it can't, else undefined.
   * Everything else in the file (whatever else it holds about a person) is kept as it is.
   */
  edit(edit: unknown): string | undefined {
    if (!isObj(edit) || typeof edit.id !== 'string') return 'That change is missing who it is for';
    this.look();
    let raw: unknown;
    try {
      if (statSync(this.file).size > MAX_BYTES) return 'The team file is too big';
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'There is no team file to change yet' : 'The team file can’t be read, so nothing can be changed in it';
    }
    if (!isObj(raw) || !Array.isArray(raw.members)) return 'The team file isn’t in the shape expected';
    const member = this.current.members.find((m) => m.id === edit.id);
    const at = raw.members.findIndex((m) => isObj(m) && m.id === edit.id);
    if (!member || at < 0) return 'There is nobody by that id on the team';
    const entry = raw.members[at] as Raw;
    if (edit.desk !== undefined) {
      if (edit.desk === null) entry.desk = null;
      else if (typeof edit.desk !== 'string' || !DESK_IDS.has(edit.desk)) return 'There is no such desk';
      else {
        if (member.remote) return `${member.name} works remotely, so has no desk`;
        const taken = this.current.members.find((m) => m.desk === edit.desk && m.id !== member.id);
        if (taken) return `That desk is ${taken.name}’s`;
        entry.desk = edit.desk;
      }
    }
    if (edit.workingOn !== undefined) {
      const t = text(edit.workingOn, 300);
      if (t === undefined) return 'What they are working on should be text';
      entry.workingOn = t;
    }
    if (edit.goodAt !== undefined) {
      if (!Array.isArray(edit.goodAt)) return 'What they are good at should be a list';
      entry.goodAt = goodAtOf(edit.goodAt);
    }
    try {
      // Written next to the file and moved over it, so a reader never sees half of it.
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e) {
      return `The team file couldn’t be written: ${(e as Error).message}`;
    }
    this.look();
    this.onState(this.current);
    return undefined;
  }

  /** Reads the file if it changed since last time. True if what's known changed. */
  private look(): boolean {
    let stamp: string;
    try {
      const s = statSync(this.file);
      stamp = `${s.size}:${s.mtimeMs}`;
    } catch {
      // No file: no team, and nothing wrong.
      stamp = 'none';
    }
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    const before = JSON.stringify(this.current);
    this.current = stamp === 'none' ? { members: [] } : this.load();
    return JSON.stringify(this.current) !== before;
  }

  private load(): TeamState {
    try {
      if (statSync(this.file).size > MAX_BYTES) throw new Error(`it’s over ${MAX_BYTES / 1024} KB`);
      const { state, problems } = readTeam(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
      return problems.length ? { ...state, error: problems.join('; ') } : state;
    } catch (e) {
      const why = e instanceof SyntaxError ? `it isn’t valid JSON (${e.message})` : (e as Error).message;
      // Keep the last good team on screen while the file is broken.
      return { members: this.current.members, ...(this.current.calendarAt !== undefined ? { calendarAt: this.current.calendarAt } : {}), error: why };
    }
  }
}
