# Player Cap Architect Dashboard

Interactive single-page dashboard to run a full-league rebuild draft with salary-cap constraints.

## What it does

- Pick a franchise to control.
- Start a snake draft where all players are available from one free-agent pool.
- Auto-generate the other 29 teams in real time.
- Track live payroll outcomes for every team:
  - salary total
  - cap-space / over-cap amount
  - luxury tax bill (progressive brackets)
  - first-apron / second-apron status
  - projected team-building restrictions after crossing thresholds

## Defaults included

The app ships with the league-announced figures for:

- Salary cap: `154.647M`
- Team salary floor: `139.182M`
- Tax line: `187.895M`
- First apron: `195.945M`
- Second apron: `207.824M`
- Non-taxpayer MLE: `14.104M`
- Taxpayer MLE: `5.685M`
- Room exception: `8.781M`

All rule values are editable in the UI.

## Player data model

- Generates randomized players/contracts by default.
- You can import a custom player file to override the pool.

## Run

Open `/Users/flint/Documents/AI Website/AI Dashboard/index.html` in a browser.

## Sources for cap thresholds

- League cap release (June 30, 2025)
