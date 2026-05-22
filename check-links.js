/**
 * check-links.js
 * פותח כל לינק של פרק בדפדפן ובודק שהוידאו נגיש
 * פלט: broken-links.json עם רשימת הפרקים שלא עובדים
 */

const puppeteer = require("puppeteer");
const fs = require("fs");

const INPUT_FILE = "one-piece-links.json";
const OUTPUT_FILE = "broken-links.json";
const CONCURRENCY = 3;       // כמה פרקים בודקים במקביל
const TIMEOUT_MS = 15000;    // 15 שניות לכל פרק

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildDriveUrl(previewUrl) {
  const match = previewUrl.match(/\/file\/d\/([^/]+)/);
  return match
    ? `https://drive.google.com/file/d/${match[1]}/preview`
    : previewUrl;
}

async function checkEpisode(browser, ep) {
  const url = buildDriveUrl(ep.url);
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  );

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });
    await sleep(2000);

    const result = await page.evaluate(() => {
      // בודק אם יש video player פעיל
      const video = document.querySelector("video");
      if (video) {
        return { ok: true, reason: "video element found" };
      }

      // בודק אם Drive מציג שגיאת גישה
      const body = document.body?.innerText || "";
      if (
        body.includes("לא ניתן לגשת") ||
        body.includes("Access denied") ||
        body.includes("Sorry, you can") ||
        body.includes("isn't available") ||
        body.includes("No preview available") ||
        body.includes("שגיאה") ||
        body.includes("quota") ||
        body.includes("too many")
      ) {
        return { ok: false, reason: body.substring(0, 100).trim() };
      }

      // בודק אם יש iframe player (Drive embed)
      const iframe = document.querySelector("iframe");
      if (iframe) {
        return { ok: true, reason: "iframe player found" };
      }

      // בודק אם הדף ריק / לא נטען
      if (!body || body.length < 50) {
        return { ok: false, reason: "empty page" };
      }

      // ברירת מחדל - לא ידוע
      return { ok: false, reason: "no video or iframe found" };
    });

    return { episode: ep.episode, url, ...result };
  } catch (err) {
    return { episode: ep.episode, url, ok: false, reason: err.message };
  } finally {
    await page.close();
  }
}

async function runBatch(browser, batch, results, total) {
  const checks = batch.map((ep) => checkEpisode(browser, ep));
  const batchResults = await Promise.all(checks);

  for (const r of batchResults) {
    results.push(r);
    const icon = r.ok ? "✅" : "❌";
    const pct = ((results.length / total) * 100).toFixed(1);
    console.log(`${icon} פרק ${String(r.episode).padStart(4)} | ${pct}% | ${r.reason}`);
  }
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ ${INPUT_FILE} לא נמצא! הרץ קודם: npm run crawl`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const episodes = data.episodes.filter((e) => e.url); // רק פרקים עם URL
  console.log(`🔍 בודק ${episodes.length} פרקים (${CONCURRENCY} במקביל)...\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const allResults = [];

  try {
    // חלוקה ל-batches
    for (let i = 0; i < episodes.length; i += CONCURRENCY) {
      const batch = episodes.slice(i, i + CONCURRENCY);
      await runBatch(browser, batch, allResults, episodes.length);
    }
  } finally {
    await browser.close();
  }

  // מיון לפי פרק
  allResults.sort((a, b) => a.episode - b.episode);

  const broken = allResults.filter((r) => !r.ok);
  const working = allResults.filter((r) => r.ok);

  // שמירת פלט
  const output = {
    checked_at: new Date().toISOString(),
    total_checked: allResults.length,
    working: working.length,
    broken: broken.length,
    broken_episodes: broken,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 סה"כ נבדקו : ${allResults.length}`);
  console.log(`✅ עובדים      : ${working.length}`);
  console.log(`❌ לא עובדים  : ${broken.length}`);
  console.log(`💾 נשמר ל      : ${OUTPUT_FILE}`);

  if (broken.length > 0) {
    console.log(`\n❌ פרקים שלא עובדים:`);
    for (const b of broken) {
      console.log(`   פרק ${b.episode}: ${b.reason}`);
    }
  }
}

main().catch(console.error);
