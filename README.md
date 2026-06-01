# FD NASCAR Monitor - Railway Fixed

This version uses the official Playwright Docker image so Railway has all Chromium dependencies.

## Railway Variables

Set these in Railway:

```env
DISCORD_WEBHOOK_URL=your_new_webhook
FANDUEL_URL=https://sportsbook.fanduel.com/motorsport
POLL_SECONDS=20
HEADLESS=true
DEBUG=false
```

## Important

Railway should detect the Dockerfile automatically. If it does not:

- Settings → Build
- Builder: Dockerfile
- Start command: leave blank or use `npm start`
