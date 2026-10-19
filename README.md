# pi-burn

See what each thread has cost. Burn puts a pill such as `$4.82 +$0.31` in two footers and keeps a detailed view behind each:

- **pi** (terminal): a pill in pi's status line, and a `/burn` overlay with four views: an overview, what each prompt cost, cost by model, and this project's spend across sessions.
- **bb**: the same pill beside the context circle under the prompt box. Clicking it opens a card with the breakdown and a per-call chart. A Burn tab in the thread's side panel lists every prompt and adds the cost of child threads, such as minions. A Burn page in bb's navigation shows spend across all threads by day, project and model.

Both halves support budgets. Burn warns at 80% and at 100% of a thread's budget. It never stops a thread unless you turn on the stop setting, which is off by default.

In bb, Burn counts every thread, whatever harness runs it. A pi thread's figures come from pi's session logs, where every assistant message already carries the cost pi recorded. Other harnesses, such as Codex and Claude Code, are read from the usage bb records for each thread, and Burn keeps its own copy of it. When a harness passes bb its own cost, Burn uses that cost as it is. Codex and Claude Code pass bb their tokens but no cost, so Burn prices their tokens with pi's list prices for OpenAI Codex and Anthropic models and marks every such amount as an estimate, for example `~$1.23`. A model without a known price shows tokens instead of dollars.

## Install

The bb plugin alone is enough in bb: it reads a pi thread's cost from pi's session logs and any other thread's from the usage bb records. The pi extension is optional. It gives the pill and `/burn` in the terminal, with or without bb, and in a bb thread it stops a run at its budget from inside pi, which is faster than stopping it through bb.

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

The host entry reads only pi's logs. Other harnesses need no host code: their provider bridges, the adapters that connect an agent such as Codex to bb, already send bb a token-usage event after each model call or turn, and some send a running cost. bb tells the plugin within a second when a thread has new events, and the plugin reads them. bb deletes older usage events and keeps only the latest one for each thread, so Burn keeps its own copy of what it read in the plugin's database, and the figures survive a plugin reload.

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
  - Its **Show** switch picks what the page measures: **Cost**, **Tokens** or **Calls**. The choice re-ranks the daily chart, the activity map, the threads, the Models table and the bars by project and by harness.
  - Under the four cost cards, usage cards show the tokens, the calls and prompts, the median call time with its 90th percentile (p90), and the failed calls.
  - **Token mix** sets each kind of token (input, cache write, cache read, output, and the reasoning part of output) against what it cost. **Call time** shows how long calls took, and how many failed or were stopped. **Activity by hour** shows the busiest hours of each day.
  - The **Models** table lists each model with its harness, calls, tokens, cost, cache hit rate, average call time, output tokens per second and failure rate. **By harness** splits the use between pi, Codex, Claude Code and any other harness.
  - The **Panels** menu, and the hide button that appears when you point at a panel, hide any panel apart from the four cost cards and the toolbar. Burn remembers the choice for every bb window.

Settings, in Burn's plugin settings:

| Setting | Default | What it does |
| --- | --- | --- |
| Cost chip | on | Shows the chip beside the context circle, or in the thread header when that row is not on screen. |
| Chip shows | Cost and last turn | Or the cost only. |
| Thread budget | none | A budget for every thread. A thread's own budget, set from the chip or the thread menu, overrides it. |
| Daily budget | none | One notification a day when all threads together pass it. |
| Budget alerts | on | Notifications at 80% and 100% of a thread's budget. |
| Stop a thread at its budget | off | Stops the run whose cost crosses the budget. In a pi thread with the pi extension, the extension stops the run itself; otherwise Burn stops the thread's current work through bb. Claude Code threads are not stopped, because their cost arrives only as each turn ends. Sending another prompt continues. |
| Flag threads over budget | on | The red flame in the sidebar. |
| Notify after an expensive prompt | off | A notification after a prompt that costs at least 3 times the thread's median and at least $0.50. |

## Troubleshooting

- **Chip shows a dashed "—" in bb:** the thread has made no model call yet, or its harness sends bb no usage. For a pi thread it also means that Burn found no session log on the thread's machine and no report from pi; check that bb keeps its pi sessions in the default folder (see Limits).
- **Chip is dimmed with an age such as "3h":** bb says a pi thread is working, but its session log has not changed since, so pi may have stopped. Threads of other harnesses are never dimmed, because a Claude Code turn can run for minutes before bb records its usage.
- **No chip in bb:** check that the **Cost chip** setting in Burn's plugin settings is on. `bb plugin list` should show `pi-burn` as running.
- **Chip is in the thread header, not the footer:** bb's footer markup was not found (see Limits). The chip works the same there.
- **No pill in pi:** the pill shows only in a terminal UI. `/burn` works in any mode.

## Limits

- bb's footer has no plugin slot. The chip is a thread header action that moves itself next to the context circle by using bb's page markup (`[data-follow-up-composer-footer]`). If bb changes that markup the chip stays in the thread header.
- The sidebar flag uses an experimental bb API; on a bb without it, the flag does not show. It covers every thread whose pi extension has reported, and every other thread active in the last 30 days.
- The Burn page counts the spend of every thread, by the days on which its model calls were made.
- Call time and failed calls come only from pi's session logs, and only from the calls pi timed. Codex and Claude Code record neither, so their figures read "—".
- The Models table's cache hit rate, average call time, output per second and failure rate cover the whole life of the threads in the range, not only the chosen days.
- The activity map counts by UTC clock hour. In a zone with a half-hour offset it shifts by half an hour, so calls in the first half hour after midnight show on the previous day.
- A report from a Burn 0.2 pi extension, or the last report of an offline machine, has no token, call-time or hourly detail until Burn reads the thread again.
- Dollar figures are list prices, either the ones pi recorded or Burn's estimates (`~$`). Neither knows about discounts or what a proxy actually bills. Estimates also price every cache write as a five-minute write, because bb's usage events do not say which writes were one-hour writes.
- Claude Code threads update once per turn, do not count Claude Code's subagents, and are never stopped at their budget, though budget alerts still fire.
- Router aliases such as `shopify/auto-best` have no known price, so their threads show tokens.
- Usage that bb deleted before Burn first read a thread counts as one entry: the total is right, but the split by day and model is lost. Claude Code's running total can start again between turns, so for a Claude Code thread such usage is lost instead.
- A harness that sends bb no usage shows nothing, and a cost in a currency other than US dollars is not converted, so that thread shows tokens.
- A forked session counts only from its creation, so pi's own footer reads higher for it.
- The server-side stop, used when the pi extension is not installed, ends the thread's current work through bb.
- Session logs are read from `~/.bb/pi-bridge-sessions` on each machine. bb's pi bridge can be pointed elsewhere with `BB_PI_BRIDGE_SESSION_DIR`, but Burn does not follow it.
- After a machine's bb daemon restarts, live updates for its threads resume within a minute.
- pi orders status entries by key, so where the pill sits next to other markers is up to pi.

## Development

```bash
npm install
npm test
npm run typecheck
bb plugin build
```

The layout is `src/` (shared report, formatting and budget code), `extensions/pi` (the pi extension) and `extensions/bb` (the bb plugin). `test/layout.test.ts` keeps the halves from importing each other's dependencies.
