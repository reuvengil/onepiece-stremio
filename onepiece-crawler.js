/**
 * One Piece - AnimeIsrael Crawler
 * מחלץ את כל לינקי הפרקים של וואן פיס מהאתר animeisrael.co.il
 * פלט: one-piece-links.json
 */

const puppeteer = require("puppeteer");
const fs = require("fs");

const SECTION_PAGES = [
  { url: "https://animeisrael.co.il/one-piece-season-1/",   range: "1-50"      },
  { url: "https://animeisrael.co.il/one-piece-season-1-2/", range: "51-100"    },
  { url: "https://animeisrael.co.il/one-piece-p3/",         range: "101-200"   },
  { url: "https://animeisrael.co.il/one-piece-p4/",         range: "201-300"   },
  { url: "https://animeisrael.co.il/one-piece-p5/",         range: "301-400"   },
  { url: "https://animeisrael.co.il/one-piece-p6/",         range: "401-600"   },
  { url: "https://animeisrael.co.il/one-piece-p7/",         range: "601-800"   },
  { url: "https://animeisrael.co.il/one-piece-p8/",         range: "801-1000"  },
  { url: "https://animeisrael.co.il/one-piece-p9/",         range: "1001-1097" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractEpisodeNumber(text) {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

async function crawlSectionPage(browser, sectionInfo) {
  console.log(`\n📄 טוען דף: ${sectionInfo.range} — ${sectionInfo.url}`);
  const page = await browser.newPage();

  // User-agent כדי לא להיחסם
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  );

  const results = {};

  try {
    await page.goto(sectionInfo.url, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(2000);

    // --- שלב 1: מחפש כפתורי פרקים עם data-settings של Elementor popup ---
    // הכפתורים של Elementor נראים כך:
    // <a href="#" data-elementor-open-lightbox="" data-elementor-lightbox-slideshow="...">פרק 1</a>
    // או: <div class="elementor-button-wrapper"><a ...>פרק 1</a></div>

    // אוסף את כל ה-selectors האפשריים
    const episodeElements = await page.evaluate(() => {
      const results = [];
      // כל הלינקים והכפתורים
      const all = document.querySelectorAll("a, button, [role='button'], .elementor-button");
      for (const el of all) {
        const text = el.textContent?.trim() || "";
        if (!/פרק\s*\d+|\d+\s*פרק/.test(text)) continue;

        // מידע לזיהוי האלמנט
        results.push({
          text,
          tag: el.tagName,
          href: el.getAttribute("href"),
          dataSettings: el.getAttribute("data-settings"),
          id: el.id || null,
          classes: el.className,
          // selector ייחודי לאיתור מחדש
          uniqueText: text,
        });
      }
      return results;
    });

    console.log(`  נמצאו ${episodeElements.length} כפתורי פרקים`);

    // DEBUG: הדפסת הכפתור הראשון לבדיקה
    if (episodeElements.length > 0) {
      console.log(`  🔍 דוגמה לכפתור:`, JSON.stringify(episodeElements[0]));
    }

    for (const elInfo of episodeElements) {
      const epNum = extractEpisodeNumber(elInfo.text);
      if (!epNum || results[epNum]) continue; // דלג על כפירים כפולים

      try {
        // מציאת האלמנט מחדש ע"י evaluate+click (לא XPath)
        const clicked = await page.evaluate((targetText) => {
          const all = document.querySelectorAll("a, button, [role='button'], .elementor-button");
          for (const el of all) {
            if (el.textContent?.trim() === targetText) {
              el.click();
              return true;
            }
          }
          return false;
        }, elInfo.uniqueText);

        if (!clicked) {
          console.log(`  ⚠️  פרק ${epNum}: לא נמצא אלמנט ללחיצה`);
          continue;
        }

        // ממתין לפתיחת popup או שינוי DOM
        await sleep(2500);

        // מחפש iframe של Google Drive / כל iframe שנפתח
        const iframeSrc = await page.evaluate(() => {
          // בודק בכל ה-iframes בדף
          const iframes = Array.from(document.querySelectorAll("iframe"));
          for (const iframe of iframes) {
            const src = iframe.src || iframe.getAttribute("src") || "";
            if (src.includes("drive.google.com") || src.includes("google.com/file")) {
              return src;
            }
          }
          // בודק גם בתוך shadow DOM או dialogs
          const dialog = document.querySelector(
            ".elementor-popup-modal iframe, .dialog-widget-content iframe, [data-elementor-type='popup'] iframe"
          );
          return dialog ? dialog.src : null;
        });

        if (iframeSrc) {
          results[epNum] = { episode: epNum, url: iframeSrc };
          console.log(`  ✅ פרק ${epNum}: ${iframeSrc.substring(0, 60)}...`);
        } else {
          // ניסיון גיבוי: מחפש שינויים ב-network (request intercept)
          results[epNum] = { episode: epNum, url: null };
          console.log(`  ⚠️  פרק ${epNum}: iframe לא נמצא לאחר לחיצה`);
        }

        // סוגר popup ע"י Escape או לחיצה על X
        await page.keyboard.press("Escape");
        await sleep(800);

      } catch (err) {
        console.log(`  ❌ פרק ${epNum}: ${err.message}`);
        results[epNum] = { episode: epNum, url: null, error: err.message };
      }
    }

    // --- שלב 2 (גיבוי): מחפש drive links ישירים ב-HTML ---
    if (Object.values(results).filter((r) => r.url).length === 0) {
      console.log(`  🔎 מנסה גיבוי: חיפוש drive links ישירים...`);
      const directLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll("a[href*='drive.google.com'], iframe[src*='drive.google.com']").forEach((el) => {
          links.push(el.href || el.src);
        });
        // גם בתוכן הטקסטואלי
        const bodyText = document.body.innerText;
        const matches = bodyText.match(/https:\/\/drive\.google\.com\/[^\s"']+/g);
        if (matches) links.push(...matches);
        return [...new Set(links)];
      });
      console.log(`  📎 נמצאו ${directLinks.length} drive links ישירים:`, directLinks);
    }

  } catch (err) {
    console.error(`  ❌ שגיאה בטעינת הדף: ${err.message}`);
  } finally {
    await page.close();
  }

  return results;
}

// ---- Network intercept mode (גיבוי חזק) ----
async function crawlWithInterception(browser, sectionInfo) {
  console.log(`\n📡 מצב intercept: ${sectionInfo.range}`);
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  );

  const results = {};
  const capturedDriveUrls = [];

  // מיירט כל request ל-drive.google.com
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("drive.google.com")) {
      capturedDriveUrls.push(url);
    }
    req.continue();
  });

  try {
    await page.goto(sectionInfo.url, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(2000);

    const episodeElements = await page.evaluate(() => {
      const els = [];
      document.querySelectorAll("a, button, [role='button']").forEach((el) => {
        const text = el.textContent?.trim() || "";
        if (/פרק\s*\d+|\d+\s*פרק/.test(text)) {
          els.push(text);
        }
      });
      return [...new Set(els)]; // ייחודיים
    });

    console.log(`  נמצאו ${episodeElements.length} פרקים`);

    for (const epText of episodeElements) {
      const epNum = extractEpisodeNumber(epText);
      if (!epNum || results[epNum]) continue;

      capturedDriveUrls.length = 0; // איפוס לפני כל לחיצה

      await page.evaluate((targetText) => {
        document.querySelectorAll("a, button, [role='button']").forEach((el) => {
          if (el.textContent?.trim() === targetText) el.click();
        });
      }, epText);

      await sleep(3000);

      // בודק אם נתפס URL
      if (capturedDriveUrls.length > 0) {
        results[epNum] = { episode: epNum, url: capturedDriveUrls[0] };
        console.log(`  ✅ פרק ${epNum}: ${capturedDriveUrls[0].substring(0, 60)}`);
      } else {
        // מחפש iframe ישיר
        const iframeSrc = await page.evaluate(() => {
          const iframe = document.querySelector(
            ".elementor-popup-modal iframe, .dialog-lightbox-widget-content iframe, iframe[src*='drive']"
          );
          return iframe ? iframe.src : null;
        });
        results[epNum] = { episode: epNum, url: iframeSrc };
        if (iframeSrc) {
          console.log(`  ✅ פרק ${epNum} (iframe): ${iframeSrc.substring(0, 60)}`);
        } else {
          console.log(`  ⚠️  פרק ${epNum}: לא נתפס URL`);
        }
      }

      await page.keyboard.press("Escape");
      await sleep(600);
    }
  } finally {
    await page.close();
  }

  return results;
}

async function main() {
  console.log("🏴‍☠️  מתחיל Crawling של וואן פיס - AnimeIsrael\n");
  console.log("💡 שימוש במצב network interception לתפיסת drive URLs\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
  });

  const allResults = {};

  try {
    for (const section of SECTION_PAGES) {
      // מצב intercept - חזק יותר מלחיצה רגילה
      const sectionResults = await crawlWithInterception(browser, section);
      Object.assign(allResults, sectionResults);
      await sleep(2000);
    }
  } finally {
    await browser.close();
  }

  const sorted = Object.values(allResults).sort((a, b) => a.episode - b.episode);

  const output = {
    generated_at: new Date().toISOString(),
    total_episodes: sorted.length,
    found: sorted.filter((e) => e.url).length,
    not_found: sorted.filter((e) => !e.url).length,
    episodes: sorted,
  };

  const outputPath = "one-piece-links.json";
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log("\n✅ סיום!");
  console.log(`📊 סה"כ פרקים: ${output.total_episodes}`);
  console.log(`✅ נמצאו לינקים: ${output.found}`);
  console.log(`⚠️  לא נמצאו: ${output.not_found}`);
  console.log(`💾 נשמר ל: ${outputPath}`);
}

main().catch(console.error);
