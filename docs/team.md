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
- Only admins can change the team. Whoever signs in with the shared password is an admin. Anyone else sees the markers as clickable only: pressing and dragging one says that only admins can change the team, and the dropdown is greyed out.

## The desks

The six desks in the real room are for people, and two more made-up ones are in the board room. Their ids are `west`, `middle`, `armoire`, `whiteboard`, `window`, `door`, `board-1` and `board-2`. Agents don't sit at these. They work at the two long rows in the room next door.

## Whether someone is free

The light over someone's head shows `free`, `busy`, `away` or `unknown`.

The app doesn't read calendars itself. Something outside it writes the answer into `team.json`, and the server picks up the change:

```json
"availability": { "state": "busy", "source": "calendar", "checkedAt": 1793620800000, "until": 1793624400000 }
```

`checkedAt` and `until` are milliseconds since the epoch. An answer from a calendar counts as `unknown` once `until` has passed, or when it was last checked more than two hours ago. A person shown as free is therefore only as current as the last sync.
