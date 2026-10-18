# pi-burn

See what each thread has cost. Burn puts a pill such as `$4.82 +$0.31` in two footers and keeps a detailed view behind each:

- **pi** (terminal): a pill in pi's status line, and a `/burn` overlay with four views: an overview, what each prompt cost, cost by model, and this project's spend across sessions.
- **bb**: the same pill beside the context circle under the prompt box. Clicking it opens a card with the breakdown and a per-call chart. A Burn tab in the thread's side panel lists every prompt and adds the cost of child threads, such as minions. A Burn page in bb's navigation shows spend across all threads by day, project and model.

Both halves support budgets. Burn warns at 80% and at 100% of a thread's budget. It never stops a thread unless you turn on the stop setting, which is off by default.

The numbers are pi's own: every assistant message in a pi session already carries its exact cost, so there is no price table and nothing is estimated. Burn only supports pi threads for now.

## Install

Install both halves to get the pill in bb. The pi extension alone gives the pill and `/burn` in the terminal.

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

Requirements: bb 0.46 or newer, and a pi that provides `ctx.mode` (1.x).

After installing, start a new pi thread in bb. bb gives pi the address to report to only when it starts a pi session, so a thread that was already running reports after it restarts. Until then, Burn reads that thread's cost from its pi session log (see below).

## How the halves connect

bb ignores a pi extension's footer status, so in a bb thread the pi extension sends its numbers to the plugin. The plugin gives pi an address through the `BURN_BB_URL` environment variable, and pi posts a small JSON report when a run starts, after each model call, and when the run ends. Only bb's own pi reports (RPC mode); a `pi -p` started from a thread's shell does not. The plugin keeps the latest report per thread, including across restarts, and ignores a report older than the one it holds.

The plugin's reply carries the thread's budget policy, so pi in a bb thread follows bb's budget settings. A thread budget set in bb takes precedence over one set with `/burn budget`.

A thread that never reports still has a cost: threads started before Burn was installed, and child threads such as minions that they started. For those, the plugin reads the thread's pi session log, the file bb's pi bridge keeps for it, and builds the same report pi would. The card then says "from pi's log", the figure refreshes every minute, and budgets warn and stop only once the thread restarts and reports. These totals match bb's thread-spend plugin.

## Usage in pi

The pill shows the total, then what the last prompt added. While pi works, a spinner replaces the flame. With a budget, the pill turns amber at 80%, turns red at 100%, and shows the budget in place of the last-prompt amount.

| Command | What it does |
| --- | --- |
| `/burn` | Opens the overlay on the overview. Tab or the arrow keys switch views, `c` copies a Markdown summary, and Esc closes it. |
| `/burn turns`, `/burn models`, `/burn history` | Opens that view. In Turns, Enter expands a prompt. In History, Enter resumes a session. |
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

Outside the terminal UI, `/burn` prints the same figures as text. Sessions that report no cost (subscriptions, local models) show total tokens (`1.2M tok`) instead of dollars. Totals cover the whole session file, forks and abandoned branches included, so they agree with the line in pi's own footer.

## Usage in bb

- The chip shows this thread's own cost, as pi's footer does. Click it for the breakdown, including the total with its child threads. From the card you can open the Burn tab in the side panel, set a budget for the thread, or copy a summary.
- Every thread menu has a **Cost** entry with the thread's cost, including its children, and the same actions.
- Threads over their budget get a red flame in the sidebar.
- The **Burn** page in bb's navigation shows spend for today, the last 7 days or the last 30 days, optionally for one project.

Settings, in Burn's plugin settings:

| Setting | Default | What it does |
| --- | --- | --- |
| Cost chip | on | Shows the chip beside the context circle, or in the thread header when that row is not on screen. |
| Chip shows | Cost and last turn | Or the cost only. |
| Thread budget | none | A budget for every thread. A thread's own budget, set from the chip or the thread menu, overrides it. |
| Daily budget | none | One notification a day when all threads together pass it. |
| Budget alerts | on | Notifications at 80% and 100% of a thread's budget. |
| Stop a thread at its budget | off | Stops the pi run whose cost crosses the budget. Sending another prompt continues. |
| Flag threads over budget | on | The red flame in the sidebar. |
| Notify after an expensive prompt | off | A notification after a prompt that costs at least 3 times the thread's median and at least $0.50. |

## Troubleshooting

- **Chip shows a dashed "—" in bb:** the thread has not reported and Burn found no session log for it. Check that it runs on pi. A thread on another machine keeps its log there (see Limits).
- **Card says "from pi's log":** the thread does not report to Burn, usually because it started before Burn was installed. Restart it for live updates and budgets.
- **Chip is dimmed with an age such as "3h":** pi said it was working but has not reported since. The thread's pi process may have stopped.
- **No chip in bb:** check that the **Cost chip** setting in Burn's plugin settings is on. `bb plugin list` should show `pi-burn` as running.
- **Chip is in the thread header, not the footer:** bb's footer markup was not found (see Limits). The chip works the same there.
- **No pill in pi:** the pill shows only in a terminal UI. `/burn` works in any mode.

## Limits

- bb's footer has no plugin slot. The chip is a thread header action that moves itself next to the context circle by using bb's page markup (`[data-follow-up-composer-footer]`). If bb changes that markup the chip stays in the thread header.
- The sidebar flag uses an experimental bb API; on a bb without it, the flag does not show.
- The Burn page counts the spend of every pi thread, by the days on which pi made the calls. Session logs are read only on the machine that runs bb, so a thread that runs on another host counts only once it reports.
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
