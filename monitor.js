require("dotenv").config();
const { chromium } = require("playwright");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const URL = process.env.FANDUEL_URL || "https://sportsbook.fanduel.com/motorsport";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 20);
const HEADLESS = String(process.env.HEADLESS || "false").toLowerCase() === "true";
const DEBUG = String(process.env.DEBUG || "false").toLowerCase() === "true" || process.env.DEBUG === "1";

const alerted = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAmericanOdds(value) {
  if (!value) return null;
  const text = String(value).replace(/\u2212/g, "-").trim();
  const match = text.match(/[+-]\d{2,5}/);
  if (!match) return null;
  return Number(match[0]);
}

function formatOdds(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value > 0 ? `+${value}` : String(value);
}

function oddsSortValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return -999999;
  return value;
}

function issuesFor(row) {
  const hits = [];

  if (row.top3 !== null && row.winner !== null && row.top3 >= row.winner) {
    hits.push(`Top 3 ${row.top3 > row.winner ? "higher than" : "same as"} Winner`);
  }

  if (row.top5 !== null && row.winner !== null && row.top5 >= row.winner) {
    hits.push(`Top 5 ${row.top5 > row.winner ? "higher than" : "same as"} Winner`);
  }

  if (row.top5 !== null && row.top3 !== null && row.top5 >= row.top3) {
    hits.push(`Top 5 ${row.top5 > row.top3 ? "higher than" : "same as"} Top 3`);
  }

  return hits;
}

async function sendDiscord(row, issues) {
  const issueText = issues.join(" | ");
  const key = `${row.driver}|${row.winner}|${row.top3}|${row.top5}|${issueText}`;
  if (alerted.has(key)) return;

  alerted.add(key);

  const bestBadMarket =
    row.top5 !== null && row.winner !== null && row.top5 >= row.winner ? "Top 5" :
    row.top3 !== null && row.winner !== null && row.top3 >= row.winner ? "Top 3" :
    row.top5 !== null && row.top3 !== null && row.top5 >= row.top3 ? "Top 5" :
    "Check market";

  const content =
`🚨 **FanDuel NASCAR Pricing Alert**

**${row.driver}**

Winner: ${formatOdds(row.winner)}
Top 3: ${formatOdds(row.top3)}
Top 5: ${formatOdds(row.top5)}

**Likely value side:** ${bestBadMarket}

${issues.map(x => `• ${x}`).join("\n")}

${URL}`;

  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

    if (!res.ok) {
      console.error(`Discord error ${res.status}:`, await res.text());
    } else {
      console.log(`Discord alert sent: ${row.driver} — ${issueText}`);
    }
  } catch (err) {
    console.error("Discord send failed:", err.message);
  }
}

function mergeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!row.driver) continue;
    const driver = row.driver.trim().replace(/\s+/g, " ");
    if (!map.has(driver)) {
      map.set(driver, { driver, winner: null, top3: null, top5: null });
    }

    const current = map.get(driver);
    if (row.winner !== null && current.winner === null) current.winner = row.winner;
    if (row.top3 !== null && current.top3 === null) current.top3 = row.top3;
    if (row.top5 !== null && current.top5 === null) current.top5 = row.top5;
  }

  return [...map.values()].filter(r => r.winner !== null || r.top3 !== null || r.top5 !== null);
}

/**
 * Structured scrape.
 * This tries to read visible button/cards and group nearby odds by driver.
 * FanDuel changes classes often, so this intentionally relies more on text/roles than class names.
 */
async function scrapeStructured(page) {
  return await page.evaluate(() => {
    function clean(s) {
      return (s || "").replace(/\s+/g, " ").trim();
    }

    function parseOdd(s) {
      const m = clean(s).match(/[+-]\d{2,5}/);
      return m ? Number(m[0]) : null;
    }

    function driverNameFromText(text) {
      const cleaned = clean(text)
        .replace(/[+-]\d{2,5}.*/, "")
        .replace(/\bTop\s*3\b/ig, "")
        .replace(/\bTop\s*5\b/ig, "")
        .replace(/\bWinner\b/ig, "")
        .trim();

      const m = cleaned.match(/[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3}/);
      return m ? m[0].trim() : null;
    }

    const buttons = [...document.querySelectorAll("button, [role='button'], a")];
    const candidates = [];

    for (const el of buttons) {
      const text = clean(el.innerText || el.textContent || "");
      const odd = parseOdd(text);
      if (odd === null) continue;

      const label = clean(el.getAttribute("aria-label") || el.getAttribute("title") || text);
      const full = `${label} ${text}`;
      const driver = driverNameFromText(full);
      if (!driver) continue;

      let market = null;
      if (/top\s*3/i.test(full)) market = "top3";
      else if (/top\s*5/i.test(full)) market = "top5";
      else if (/winner|outright|race winner|to win/i.test(full)) market = "winner";

      candidates.push({ driver, market, odd, text: full });
    }

    const rows = [];
    for (const c of candidates) {
      if (!c.market) continue;
      rows.push({
        driver: c.driver,
        winner: c.market === "winner" ? c.odd : null,
        top3: c.market === "top3" ? c.odd : null,
        top5: c.market === "top5" ? c.odd : null
      });
    }

    return rows;
  });
}

/**
 * Text fallback.
 * If the page presents columns as visible text, this scans for driver names followed by odds.
 */
async function scrapeTextFallback(page) {
  const body = await page.locator("body").innerText({ timeout: 15000 });
  const lines = body
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const rows = [];

  const driverRegex = /^[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3}$/;
  const oddRegex = /^[+-]\d{2,5}$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!driverRegex.test(line)) continue;

    const nextOdds = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const odd = parseAmericanOdds(lines[j]);
      if (oddRegex.test(lines[j]) && odd !== null) {
        nextOdds.push(odd);
      }
      if (nextOdds.length >= 3) break;
    }

    if (nextOdds.length >= 2) {
      rows.push({
        driver: line,
        winner: nextOdds[0] ?? null,
        top3: nextOdds[1] ?? null,
        top5: nextOdds[2] ?? null
      });
    }
  }

  return rows;
}

async function clickLikelyNASCARMarkets(page) {
  const labels = [
    /nascar/i,
    /cracket barrel|cracker barrel/i,
    /race winner/i,
    /winner/i,
    /top\s*3/i,
    /top\s*5/i
  ];

  for (const label of labels) {
    try {
      const target = page.getByText(label).first();
      if (await target.count()) {
        await target.click({ timeout: 1500 }).catch(() => {});
        await sleep(1000);
      }
    } catch (_) {}
  }
}

async function scrape(page) {
  console.log(`[${new Date().toLocaleTimeString()}] Loading FanDuel...`);

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(7000);

  await clickLikelyNASCARMarkets(page);
  await sleep(3000);

  let rows = [];
  try {
    rows = rows.concat(await scrapeStructured(page));
  } catch (err) {
    console.error("Structured scrape failed:", err.message);
  }

  try {
    rows = rows.concat(await scrapeTextFallback(page));
  } catch (err) {
    console.error("Text fallback failed:", err.message);
  }

  rows = mergeRows(rows);

  if (DEBUG) {
    console.log("Parsed rows:");
    console.table(rows.map(r => ({
      driver: r.driver,
      winner: formatOdds(r.winner),
      top3: formatOdds(r.top3),
      top5: formatOdds(r.top5)
    })));
  } else {
    console.log(`Parsed ${rows.length} driver rows.`);
  }

  let alerts = 0;

  rows.sort((a, b) => {
    const aBest = Math.max(oddsSortValue(a.top3), oddsSortValue(a.top5));
    const bBest = Math.max(oddsSortValue(b.top3), oddsSortValue(b.top5));
    return bBest - aBest;
  });

  for (const row of rows) {
    const issues = issuesFor(row);
    if (!issues.length) continue;

    alerts++;
    console.log("ALERT:", row.driver, {
      winner: formatOdds(row.winner),
      top3: formatOdds(row.top3),
      top5: formatOdds(row.top5),
      issues
    });

    await sendDiscord(row, issues);
  }

  if (!alerts) {
    console.log("No bad pricing found this pass.");
  }
}

(async () => {
  if (!WEBHOOK || WEBHOOK.includes("PASTE_NEW_DISCORD_WEBHOOK_HERE")) {
    console.error("Missing DISCORD_WEBHOOK_URL. Edit .env and add a new Discord webhook.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 50
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  console.log("FanDuel NASCAR monitor running.");
  console.log("URL:", URL);
  console.log("Poll seconds:", POLL_SECONDS);
  console.log("Headless:", HEADLESS);

  while (true) {
    try {
      await scrape(page);
    } catch (err) {
      console.error("Monitor pass failed:", err.message);
    }

    await sleep(POLL_SECONDS * 1000);
  }
})();
