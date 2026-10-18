# pi-burn

See what each thread has cost. Burn puts a pill such as `$4.82 +$0.31` in two footers and keeps a detailed view behind each:

- **pi** (terminal): a pill in pi's status line, and a `/burn` overlay with four views: an overview, what each prompt cost, cost by model, and this project's spend across sessions.
- **bb**: the same pill beside the context circle under the prompt box. Clicking it opens a card with the breakdown and a per-call chart. A Burn tab in the thread's side panel lists every prompt and adds the cost of child threads, such as minions. A Burn page in bb's navigation shows spend across all threads by day, project and model.

Both halves support budgets. Burn warns at 80% and at 100% of a thread's budget. It never stops a thread unless you turn on the stop setting, which is off by default.

The numbers are pi's own: every assistant message in a pi session already carries its cost, so there is no price table and nothing is estimated. Burn only supports pi threads for now.

## Install

The bb plugin alone is enough in bb: it reads each thread's cost from pi's session logs. The pi extension is optional. It gives the pill and `/burn` in the terminal, with or without bb, and in a bb thread it stops a run at its budget from inside pi, which is faster than stopping it through bb.

```bash
# pi extension
pi install git:github.com/kalindudc/burn

# bb plugin
bb plugin install git:https://github.com/kalindudc/burn
```

From a local checkout instead:

```bash
git clone https://github.com/kalindudc/burn && cd burn
npm ci --ignore-scripts
pi install "$PWD"
bb plugin install path:"$PWD"
```

Do not install the bb plugin from npm: the npm package ships only the pi extension, and bb needs the whole repository to build the plugin. Update with `pi update git:github.com/kalindudc/burn` and `bb plugin update pi-burn`. A bare `pi update` updates pi itself, not its packages.

Requirements: bb 0.46 or newer. The pi extension needs a pi that provides `ctx.mode` (1.x).

Threads that were already running show their cost as soon as the bb plugin is installed. With the pi extension, a thread that was already running starts reporting to the plugin after it restarts, because bb gives pi the address to report to only when it starts a pi session.

## How the halves connect

The bb plugin has a host entry: code that bb runs on every connected machine. It reads the session log that bb's pi bridge keeps for each pi thread on that machine, builds the same report pi would, and watches the log folder, so the chip updates about a second after pi finishes a model call. It reads only the bytes pi appended since the last read. The plugin keeps the last figures a machine gave, so a thread on a machine that is offline still shows its cost. Whether a thread is working comes from bb's own thread status.

The pi extension's report is optional. bb ignores a pi extension's footer status, so in a bb thread the pi extension sends its numbers to the plugin. The plugin gives pi an address through the `BURN_BB_URL` environment variable, and pi posts a small JSON report when a run starts, after each model call, and when the run ends. Only bb's own pi reports (RPC mode); a `pi -p` started from a thread's shell does not. The figures still come from the session log; the report adds only what the log cannot know: the budget set with `/burn budget`, when pi stopped a run, and the context window.

The plugin's reply carries the thread's budget policy, so pi in a bb thread follows bb's budget settings. A thread budget set in bb takes precedence over one set with `/burn budget`.

## Usage in pi

The pill shows the total, then what the last prompt added. While pi works, a spinner replaces the flame. With a budget, the pill turns amber at 80%, turns red at 100%, and shows the budget in place of the last-prompt amount.

| Command | What it does |
| --- | --- |
| `/burn` | Opens the overlay on the overview. Tab or the arrow keys switch views, `c` copies a Markdown summary, and Esc closes it. |
| `/burn turns`, `/burn models`, `/burn history` | Opens that view. In Turns, Enter expands a prompt. In History, Enter resumes a session and `u` switches between local and UTC days. |
| `/burn budget` | Shows the budget in effect and where it comes from. |
| `/burn budget 10`, `/burn budget off` | Sets or clears this thread's budget. |
| `/burn budget default 10`, `/burn budget default off` | Sets or clears the budget for threads without their own. |
| `/burn copy` | Copies a Markdown summary of the thread's cost to the clipboard. |
| `/burn settings` | Shows Burn's settings. |

The settings are stored in `burn.json` in pi's agent directory:

| Setting | Default | What it does |
| --- | --- | --- |
| Default budget | none | A budget for threads that have none of their own. |
| Stop a run at the budget | off | Aborts the pi run whose cost crosses the budget. A thread already over its budget is not stopped again, so sending another prompt continues. |
| Nudge after an expensive prompt | off | Notifies after a prompt that costs at least 3 times the thread's median prompt and at least $0.50. |

Outside the terminal UI, `/burn` prints the same figures as text. Sessions that report no cost (subscriptions, local models) show total tokens (`1.2M tok`) instead of dollars. Totals cover the whole session file, abandoned branches included, so they agree with the line in pi's own footer. The exception is a forked session, such as a side chat or `/fork`: it starts as a copy of its parent's session, so Burn counts it only from its creation, and pi's own footer reads higher for it.

## Usage in bb

- The chip shows this thread's own cost, as pi's footer does. Click it for the breakdown, including the total with its child threads. From the card you can open the Burn tab in the side panel, set a budget for the thread, or copy a summary.
- Every thread menu has a **Cost** entry with the thread's cost, including its children, and the same actions.
- Threads over their budget get a red flame in the sidebar.
- The **Burn** page in bb's navigation shows spend for today, the last 7 days or the last 30 days, optionally for one project. Its **Local · UTC** switch picks which calendar day counts as today: the bb machine's local day, the default, or the UTC day that Shopify's AI proxy and menu bar count. The page remembers the choice.

Settings, in Burn's plugin settings:

| Setting | Default | What it does |
| --- | --- | --- |
| Cost chip | on | Shows the chip beside the context circle, or in the thread header when that row is not on screen. |
| Chip shows | Cost and last turn | Or the cost only. |
| Thread budget | none | A budget for every thread. A thread's own budget, set from the chip or the thread menu, overrides it. |
| Daily budget | none | One notification a day when all threads together pass it. |
| Budget alerts | on | Notifications at 80% and 100% of a thread's budget. |
| Stop a thread at its budget | off | Stops the pi run whose cost crosses the budget: the pi extension stops the run itself; without it, Burn stops the thread's current work through bb. Sending another prompt continues. |
| Flag threads over budget | on | The red flame in the sidebar. |
| Notify after an expensive prompt | off | A notification after a prompt that costs at least 3 times the thread's median and at least $0.50. |

## Troubleshooting

- **Chip shows a dashed "—" in bb:** Burn found no session log for the thread on its machine and no report from pi. Check that it runs on pi and has had a first prompt, and that bb keeps its pi sessions in the default folder (see Limits).
- **Chip is dimmed with an age such as "3h":** bb says the thread is working, but its session log has not changed since. The thread's pi process may have stopped.
- **No chip in bb:** check that the **Cost chip** setting in Burn's plugin settings is on. `bb plugin list` should show `pi-burn` as running.
- **Chip is in the thread header, not the footer:** bb's footer markup was not found (see Limits). The chip works the same there.
- **No pill in pi:** the pill shows only in a terminal UI. `/burn` works in any mode.

## Limits

- bb's footer has no plugin slot. The chip is a thread header action that moves itself next to the context circle by using bb's page markup (`[data-follow-up-composer-footer]`). If bb changes that markup the chip stays in the thread header.
- The sidebar flag uses an experimental bb API; on a bb without it, the flag does not show. It covers every thread whose pi extension has reported, and other pi threads active in the last 30 days.
- The Burn page counts the spend of every pi thread, by the days on which pi made the calls.
- Costs are pi's recorded list prices, not what a proxy or a discount actually bills.
- A forked session counts only from its creation, so pi's own footer reads higher for it.
- The server-side stop, used when the pi extension is not installed, ends the thread's current work through bb.
- Session logs are read from `~/.bb/pi-bridge-sessions` on each machine. bb's pi bridge can be pointed elsewhere with `BB_PI_BRIDGE_SESSION_DIR`, but Burn does not follow it.
- After a machine's bb daemon restarts, live updates for its threads resume within a minute.
- pi orders status entries by key, so where the pill sits next to other markers is up to pi.
- Providers other than pi (Claude Code, Codex) are not supported yet.

## Development

```bash
npm install
npm test
npm run typecheck
bb plugin build
```

The layout is `src/` (shared report, formatting and budget code), `extensions/pi` (the pi extension) and `extensions/bb` (the bb plugin). `test/layout.test.ts` keeps the halves from importing each other's dependencies.
