const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

function loadEpisodes() {
  const filePath = path.join(__dirname, "one-piece-links.json");
  if (!fs.existsSync(filePath)) {
    console.error("❌ one-piece-links.json לא נמצא!");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const map = {};
  for (const ep of data.episodes) {
    if (ep.url) map[ep.episode] = ep.url;
  }
  console.log(`✅ נטענו ${Object.keys(map).length} פרקים`);
  return map;
}

const EPISODES = loadEpisodes();
const SERIES_ID = "onepiece_israel";
const EPISODE_NUMS = Object.keys(EPISODES).map(Number).sort((a, b) => a - b);

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

app.get("/ping", (_req, res) => {
  res.json({ status: "alive", time: new Date().toISOString() });
});

app.get("/manifest.json", (_req, res) => {
  res.json({
    id: "community.onepiece.israel",
    version: "1.0.0",
    name: "וואן פיס ישראל 🏴‍☠️",
    description: "וואן פיס בעברית - כל הפרקים מתורגמים מ-animeisrael.co.il",
    logo: "https://upload.wikimedia.org/wikipedia/en/9/90/One_Piece_anime_logo.png",
    catalogs: [
      { type: "series", id: "onepiece_israel_catalog", name: "וואן פיס ישראל" }
    ],
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    idPrefixes: [SERIES_ID],
    behaviorHints: { adult: false, p2p: false }
  });
});

app.get("/catalog/series/onepiece_israel_catalog.json", (_req, res) => {
  res.json({
    metas: [{
      id: SERIES_ID,
      type: "series",
      name: "וואן פיס ישראל",
      poster: "https://m.media-amazon.com/images/M/MV5BODcwNWE3OTMtMDc3MS00NDFjLWE1OTAtNDU3NjgxODMxY2UyXkEyXkFqcGdeQXVyNTAyODkwOQ@@._V1_SX300.jpg",
      background: "https://wallpapercave.com/wp/wp2029403.jpg",
      description: "וואן פיס בעברית - כל הפרקים מתורגמים",
      releaseInfo: "1999-2024",
      imdbRating: "8.6",
      genres: ["אנימה", "הרפתקאות", "שונן"],
    }]
  });
});

app.get(`/meta/series/${SERIES_ID}.json`, (_req, res) => {
  const videos = EPISODE_NUMS.map((epNum) => ({
    id: `${SERIES_ID}:1:${epNum}`,
    title: `פרק ${epNum}`,
    season: 1,
    episode: epNum,
    released: new Date(1999, 9, 20 + epNum).toISOString(),
  }));
  res.json({
    meta: {
      id: SERIES_ID,
      type: "series",
      name: "וואן פיס ישראל",
      poster: "https://m.media-amazon.com/images/M/MV5BODcwNWE3OTMtMDc3MS00NDFjLWE1OTAtNDU3NjgxODMxY2UyXkEyXkFqcGdeQXVyNTAyODkwOQ@@._V1_SX300.jpg",
      background: "https://wallpapercave.com/wp/wp2029403.jpg",
      description: "וואן פיס בעברית - כל הפרקים מתורגמים",
      releaseInfo: "1999-2024",
      genres: ["אנימה", "הרפתקאות", "שונן"],
      videos,
    }
  });
});

// --- Proxy: מוריד את ה-redirect מ-Drive ומחזיר את ה-URL האמיתי ---
function resolveGDriveUrl(fileId, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    let cookies = "";

    function follow(url, remaining) {
      if (remaining === 0) return reject(new Error("Too many redirects"));
      const lib = url.startsWith("https") ? require("https") : require("http");
      const req = lib.request(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...(cookies ? { Cookie: cookies } : {})
        }
      }, (res) => {
        const setCookie = res.headers["set-cookie"];
        if (setCookie) cookies = setCookie.map(c => c.split(";")[0]).join("; ");
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect with no location"));
          res.destroy();
          const nextUrl = location.startsWith("http") ? location : new URL(location, url).href;
          follow(nextUrl, remaining - 1);
        } else if (res.statusCode === 200) {
          res.destroy();
          resolve(url);
        } else {
          res.destroy();
          reject(new Error("Drive returned " + res.statusCode));
        }
      });
      req.on("error", reject);
      req.end();
    }

    follow("https://drive.google.com/uc?export=download&confirm=t&id=" + fileId, maxRedirects);
  });
}

// --- Stream ---
app.get("/stream/series/:id.json", async (req, res) => {
  const id = req.params.id;
  if (!id.startsWith(SERIES_ID)) return res.json({ streams: [] });

  const epNum = parseInt(id.split(":")[2], 10);
  const url = EPISODES[epNum];
  if (!url) return res.json({ streams: [] });

  const fileIdMatch = url.match(/\/file\/d\/([^/]+)/);
  const fileId = fileIdMatch ? fileIdMatch[1] : null;
  if (!fileId) return res.json({ streams: [] });

  console.log(`▶️  פרק ${epNum}: מנסה לפתור URL מ-Drive...`);

  try {
    const directUrl = await resolveGDriveUrl(fileId);
    console.log(`✅ פרק ${epNum}: ${directUrl}`);

    res.json({
      streams: [
        {
          title: `פרק ${epNum} — מתורגם עברית 🇮🇱`,
          url: directUrl.includes("confirm=") ? directUrl : directUrl + (directUrl.includes("?") ? "&confirm=t" : "?confirm=t"),
        },
        {
          title: `פרק ${epNum} — פתח ב-Drive 🔗`,
          externalUrl: `https://drive.google.com/file/d/${fileId}/view`,
        }
      ]
    });
  } catch (err) {
    console.error(`❌ פרק ${epNum}: ${err.message}`);
    // fallback ל-externalUrl
    res.json({
      streams: [{
        title: `פרק ${epNum} — פתח ב-Drive 🔗`,
        externalUrl: `https://drive.google.com/file/d/${fileId}/view`,
      }]
    });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\n🏴‍☠️  One Piece Israel addon רץ על פורט ${PORT}`);
  console.log(`📡 manifest : http://localhost:${PORT}/manifest.json`);
  console.log(`🏓 ping     : http://localhost:${PORT}/ping`);
});