# FD NASCAR Monitor - Railway Playwright 1.60 Fix

This version pins Playwright to 1.60.0 and uses the matching Docker image:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.60.0-jammy
```

## Railway Variables

```env
DISCORD_WEBHOOK_URL=your_new_webhook
FANDUEL_URL=https://sportsbook.fanduel.com/motorsport
POLL_SECONDS=20
HEADLESS=true
DEBUG=false
```

## Important

Delete `package-lock.json` from GitHub if it exists, or replace it by redeploying after uploading this package.json.
