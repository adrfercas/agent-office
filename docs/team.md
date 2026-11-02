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
- Give someone a desk from the team window. Until then, they stand in the corridor under the "no desk yet" sign.
- **E** at someone opens their card.
- **Talk** on someone's card (and on their row in the team window) opens your chat with them in Google Chat. See [Talking to someone](#talking-to-someone).
- Only admins can change the team.

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
