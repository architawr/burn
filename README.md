# pi-burn

See what each thread has cost. Burn puts a rounded pill such as `$4.82 +0.31` in two footers and keeps a detailed view behind each:

- **pi** (terminal): a pill in pi's status line and a `/burn` panel with cost by token kind, cost by model and small graphs.
- **bb**: the same pill beside the context circle under the prompt box, with a hover card that adds a cumulative-cost chart and a cost-per-call chart.

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

Do not install the bb plugin from npm: the npm package ships only the pi extension, and bb needs the whole repository to build the plugin. Update with `pi update` and `bb plugin update pi-burn`.

Requirements: bb 0.46 or newer, and a pi that provides `ctx.mode` (1.x).

After installing, start a new pi thread in bb. bb gives pi the address to report to only when it starts a pi session, so a thread that was already running reports after it restarts. The pill and the chip show from the start and read `$0.00` until the thread has model calls.

## How the halves connect

bb ignores a pi extension's footer status, so in a bb thread the pi extension sends its numbers to the plugin. The plugin gives pi an address through the `BURN_BB_URL` environment variable, and pi posts a small JSON report after each turn. Only bb's own pi reports (RPC mode); a `pi -p` started from a thread's shell does not. The plugin keeps the latest report per thread, including across restarts, and ignores a report older than the one it holds.

## Usage

- `/burn` in pi opens the detail panel (Esc closes it). Outside the TUI it prints the same figures as text.
- In bb, hover the pill. The **Cost chip** setting in Burn's plugin settings hides it.
- Sessions that report no cost (subscriptions, local models) show total tokens (`1.2M tok`) instead of dollars.
- Totals cover the whole session file, forks and abandoned branches included, so they agree with the line in pi's own footer.

## Troubleshooting

- **Chip stuck at `$0.00` in bb:** the thread is not reporting. Check that it runs on pi and was started after Burn was installed, and hover the chip: "Waiting for pi to report" means no report has arrived.
- **No chip in bb:** check that the **Cost chip** setting in Burn's plugin settings is on. `bb plugin list` should show `pi-burn` as running.
- **Chip is in the thread header, not the footer:** bb's footer markup was not found (see Limits). The chip works the same there.
- **No pill in pi:** the pill shows only in a terminal UI. `/burn` works in any mode.

## Limits

- bb's footer has no plugin slot. The chip is a thread header action that moves itself next to the context circle by using bb's page markup (`[data-follow-up-composer-footer]`). If bb changes that markup the chip stays in the thread header.
- pi orders status entries by key, so where the pill sits next to other markers is up to pi.
- Providers other than pi (Claude Code, Codex) are not supported yet.

## Development

```bash
npm install
npm test
npm run typecheck
bb plugin build
```

The layout is `src/` (shared report and formatting code), `extensions/pi` (the pi extension) and `extensions/bb` (the bb plugin). `test/layout.test.ts` keeps the halves from importing each other's dependencies.
