# FanDuel NASCAR Monitor

Watches FanDuel Motorsport/NASCAR odds locally and sends Discord alerts when Top 3 or Top 5 prices look mispriced compared to Winner odds.

## Alerts when

- Top 3 odds are the same as or higher than Winner odds
- Top 5 odds are the same as or higher than Winner odds
- Top 5 odds are the same as or higher than Top 3 odds

## Setup

1. Open this folder in Terminal.
2. Edit `.env`.
3. Replace `PASTE_NEW_DISCORD_WEBHOOK_HERE` with a new Discord webhook.
4. Run:

```bash
npm install
npx playwright install chromium
npm start
```

Keep the browser open while it runs.

## Notes

FanDuel pages are dynamic and may change by state, location, logged-in status, or page layout. This script uses a few scraping methods:

1. Tries to extract structured odds buttons from the page.
2. Falls back to text parsing.
3. Sends alerts only once per unique driver/odds/issue combo to avoid spam.

If FanDuel loads a location screen, age screen, or blocks the browser, handle that in the open browser window and the script should keep polling.
