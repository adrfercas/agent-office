# The team

On the agentix map the office is also a picture of your team: where people sit, what they are working on, what they are good at and whether they are free. The agents you start are shown next to them, as working with you.

## Where the team is kept

The team lives in one file, `.agent-office/team.json`, in the folder the office runs from. Git ignores that folder, so nobody's name or details end up in the repository. Keep it that way: this code may be in a public fork.

With no file, the office runs as usual and the team window says no team is recorded. If the file is broken, the window shows what is wrong and the rest of the office keeps working. The server re-reads the file when it changes, so an outside edit shows up without a restart.

```json
{
  "members": [
    {
      "id": "ada-example",
      "name": "Ada Example",
      "role": "Software Engineer",
      "look": "woman",
      "desk": null,
      "workingOn": "",
      "goodAt": [],
      "chat": "https://mail.google.com/chat/u/0/#chat/dm/EXAMPLE-ID",
      "availability": { "state": "unknown" }
    }
  ]
}
```

| Field | What it means |
|---|---|
| `id` | Lowercase letters, digits and dashes. |
| `name`, `role` | Shown on their name tag and card. |
| `look` | `man` or `woman`: picks the character. Skin and hair stay the same for each `id` and aren't meant to resemble anyone. |
| `desk` | One of the people's desks, or `null` while they have none. Set it in the team window. |
| `remote` | `true` puts them on the "remote" screen in the real room instead of at a desk. |
| `self` | `true` for you. You walk about as yourself, so no character stands in for you. |
| `workingOn`, `goodAt` | Your own notes. Empty shows as not recorded. Edit them in the team window. |
| `chat` | Optional. The link to your direct chat with them in Google Chat. See [Talking to someone](#talking-to-someone). |
| `fromFiles` | Optional background from your own notes. It isn't a live status. |
| `availability` | See below. |

Nothing is filled in by guessing: what isn't known stays empty or `unknown`.

## Using it

- **U**, or **Team** in the ☰ menu, opens the team window: a small floor plan, the people, and the agents working with you. An agent's row can take you to it or open its terminal.
- **Give someone a desk by dragging.** On the floor plan in the team window, every person with a desk is a round marker, and everyone without one is a name in the **No desk yet** tray under the plan. Press on a marker or a name, drag it onto a desk (the desk lights up green) and let go.
  - A free desk is given to them. Their old desk, if they had one, is free again.
  - A desk someone already has (it lights up amber, and the name on the dragged label shows both names with ⇄ between) is a **swap**: the two trade places, in one change, so nobody is left without a desk and two people never share one. If the person you drag has no desk, whoever you drop them on goes to the tray.
  - Dropping on the tray takes the desk away. Dropping anywhere else puts the marker back and changes nothing.
  - A plain click on a marker, without dragging, takes you to that person's card.
  - Remote people aren't on the plan and can't be dragged.
  - The figure moves in the 3D room at once, in every open window, and the change is kept in the team file. If the server refuses, the marker goes back and the reason shows under the plan.
- **Without a mouse**, use the **Desk** dropdown on a person's card. It does the same: a desk someone has is listed as "swap with" and their name, and choosing it swaps.
- Until someone has a desk, they stand in the corridor under the "no desk yet" sign in the room.
- **E** at someone in the room opens their card.
- **Talk** on someone's card (and on their row in the team window) opens your chat with them in Google Chat. See [Talking to someone](#talking-to-someone).
- Only admins can change the team. Whoever signs in with the shared password is an admin. Anyone else sees the markers as clickable only: pressing and dragging one says that only admins can change the team, and the dropdown is greyed out.

## Talking to someone

The **Talk** button takes you to your direct chat with that person in Google Chat. It opens the chat in a new browser tab or window. It does not send anything, and it does not tell you whether they are online. Your own card has no Talk button.

**T** (chat) and **V** (voice) in the office are a different thing: they only reach people who are logged into the same office at that moment. Your colleagues from the team file are usually not in the office, so use Talk to reach them.

**Why the link is pasted in once.** Google documents no link that opens a direct chat from a person's name or email address. (Its Chat API can look up a direct chat by email address, but that needs a sign-in set up for the app and gives back an ID, not a link a browser can open.) The address of a direct chat is the one Google Chat shows in the browser's address bar, and it holds an ID that Google picks. One source shows it as `https://mail.google.com/chat/u/0/#chat/dm/<id>`. `https://chat.google.com/dm/<id>` is also in use, but no Google page found lists it. So the link is copied per person, once. The office does not guess it, and it does not need or keep email addresses.

**How to add it.**

1. In your browser, open Google Chat and open your chat with the person.
2. Copy the whole address from the address bar.
3. In the office, press **E** at them (or open the team window with **U**), paste it into the box under "Talk" on their card, and press **Save link**. Only admins can save it. You can also put it in `team.json` yourself, as the `chat` field.

Only `https` links on `chat.google.com` or `mail.google.com` are kept. Anything else (another site, `http`, a `javascript:` link) is refused when you save it, and left out with a note in the team window if it is in the file. **Change link** on the card replaces a saved link, and saving an empty one in the file removes it.

**Opening it in the installed Google Chat app.** The office only opens an ordinary link in a new tab. Whether that link then opens in the installed app is up to the browser, and this is only partly confirmed:

- Chrome's documentation says a link inside an installed web app's address range can be handed to the app instead of a browser tab ("link capturing"). Since version 98 this is something you turn on yourself: when you open such a link, the address bar offers "Open with" and "Remember my choice", and you can switch it on or off for one app on that app's settings page. The same page says this was a ChromeOS feature, with Windows, macOS and Linux support "in progress", so on a PC it may not be there yet. See [Declarative Link Capturing](https://developer.chrome.com/docs/web-platform/declarative-link-capturing).
- Vivaldi is built on Chromium, but nothing found says it has this setting or where it would be. It is not confirmed that the Google Chat app installed through Vivaldi takes links.
- Which of the two link forms is inside the Google Chat app's address range is not confirmed either. The app is installed from `chat.google.com`, so a `chat.google.com` link is the more likely one to be handed over than a `mail.google.com` link, which is Gmail's address.

If links do not open in the app, they open in a browser tab, where Google Chat works as usual.

## The desks

The six desks in the real room are for people, and two more made-up ones are in the board room. Their ids are `west`, `middle`, `armoire`, `whiteboard`, `window`, `door`, `board-1` and `board-2`. Agents don't sit at these. They work at the two long rows in the room next door.

## Whether someone is free

The light over someone's head shows `free`, `busy`, `away` or `unknown`.

The app doesn't read calendars itself. Something outside it writes the answer into `team.json`, and the server picks up the change:

```json
"availability": { "state": "busy", "source": "calendar", "checkedAt": 1793620800000, "until": 1793624400000 }
```

`checkedAt` and `until` are milliseconds since the epoch. An answer from a calendar counts as `unknown` once `until` has passed, or when it was last checked more than two hours ago. A person shown as free is therefore only as current as the last sync.

## Starting the office

On a Windows laptop with Docker, from the repo root in Git Bash:

```bash
scripts/agentix-office.sh start
```

That is the only command. It makes sure Docker is running (and says so if it is not), creates the container `agentix-office` if it is missing (from the image `agent-office-dev`, built from `.devcontainer/` if that is missing too), runs `npm ci` if `node_modules` is empty, builds the client once if it never was, starts Vite and the server inside the container, waits until the page answers, and prints the address (http://localhost:5173, only reachable from this computer) and the password. Running it twice does no harm. `status` shows what is running and how much CPU the container uses; `stop` stops the two servers and leaves the container and everything in it alone.

- The container keeps these settings: `--user node`, 4 CPUs, restart unless stopped, the repo mounted at `/workspaces/agent-office`, the volume `agent-office-node-modules` for `node_modules`, and port 5173 on `127.0.0.1` only.
- **The Claude Code login** is kept in the volume `agentix-office-claude` (mounted at `/home/node/.claude`, with `CLAUDE_CONFIG_DIR` pointing there), so a recreated container is still signed in. When there is no login, `start` prints `docker exec -it agentix-office claude auth login`. The script never reads the login. A container made before this volume existed keeps its login where it was and loses it if removed.
- **Edits made on Windows are not noticed by default.** The folder mount passes no file-change events into the container (a watcher inside saw nothing), so the server is started without its restart-on-change (`AGENTIX_WATCH=1` turns it on) and a change needs `stop` then `start`. `AGENTIX_POLL=1` makes Vite look at its files once a second instead, which does cost some CPU. Vite is also told to ignore the `.worktrees/` folder.
- **A second office** next to the real one (to test, say): `AGENTIX_CONTAINER=agentix-office-test AGENTIX_PORT=5198 scripts/agentix-office.sh start`. `AGENTIX_AGENT` gives the server a `--agent` of your own, for trying a made-up worker without running a real one.
- **Repos you already have.** `scripts/agentix-office.sh add-repo 'C:\path\to\repo'` adds the folder to `.agent-office/local-repos.txt` (git-ignored) and mounts it at `/workspaces/repos/<owner>/<repo>`, where the office would clone it. Picking that repo in the elevator then uses your folder and clones nothing. Agents work in their own worktrees under the repo's `.agent-office/worktrees/`, so your checkout stays on its branch, but they can change anything in that repo. Only the folders on the list are shared with the container. Docker can only mount a folder when a container is made, so `add-repo` makes a new one: the old one is stopped and renamed, and the Claude and GitHub logins move across into the volumes `agentix-office-claude` and `agentix-office-gh`.
- **GitHub goes over https** with the `gh` login, because the image has no ssh. `start` sets that up.
- Nothing in the script deletes anything. To get rid of a container or volume, do it yourself with `docker rm` or `docker volume rm`.

## Starting an agent

The agents' desks are in the two rows next door. You can walk there and press **E** at a desk, or open the team window (**U**) and press **Start an agent**: it closes the window and opens the usual hire window for the first free desk. The new agent then appears at that desk and in the list in the team window, where **Go to** walks you to it and **Terminal** opens its terminal.
