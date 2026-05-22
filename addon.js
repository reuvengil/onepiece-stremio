const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const fs = require("fs");
const path = require("path");

// --- טעינת פרקים ---
function loadEpisodes() {
  const filePath = path.join(__dirname, "one-piece-links.json");
  if (!fs.existsSync(filePath)) {
    console.error("❌ one-piece-links.json לא נמצא! הרץ קודם: npm run crawl");
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

// --- Stremio Addon ---
const builder = new addonBuilder({
  id: "community.onepiece.israel",
  version: "1.0.0",
  name: "וואן פיס ישראל 🏴‍☠️",
  description: "וואן פיס בעברית - כל הפרקים מתורגמים מ-animeisrael.co.il",
  logo: "https://animeisrael.co.il/wp-content/uploads/2023/09/One_Piece_Logo.svg.png",
  background: "https://animeisrael.co.il/wp-content/uploads/2023/05/s-l1200-1.webp",
  catalogs: [
    { type: "series", id: "onepiece_israel_catalog", name: "וואן פיס ישראל" },
  ],
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: [SERIES_ID],
});

builder.defineCatalogHandler(({ type, id }) => {
  if (type !== "series" || id !== "onepiece_israel_catalog")
    return Promise.resolve({ metas: [] });

  return Promise.resolve({
    metas: [{
      id: SERIES_ID,
      type: "series",
      name: "וואן פיס ישראל",
      poster: "https://animeisrael.co.il/wp-content/uploads/2023/05/s-l1200-1.webp",
      background: "https://animeisrael.co.il/wp-content/uploads/2023/05/s-l1200-1.webp",
      description: 'וואן פיס בעברית - כל הפרקים מתורגמים. מתורגם ע"י onepiece-nakama.com',
      releaseInfo: "1999-2024",
      imdbRating: "8.6",
      genres: ["אנימה", "שונן", "הרפתקאות"],
    }],
  });
});

builder.defineMetaHandler(({ type, id }) => {
  if (type !== "series" || id !== SERIES_ID)
    return Promise.resolve({ meta: null });

  const videos = Object.keys(EPISODES)
    .map(Number)
    .sort((a, b) => a - b)
    .map((epNum) => ({
      id: `${SERIES_ID}:1:${epNum}`,
      title: `פרק ${epNum}`,
      season: 1,
      episode: epNum,
      released: new Date(1999, 9, 20 + epNum).toISOString(),
    }));

  return Promise.resolve({
    meta: {
      id: SERIES_ID,
      type: "series",
      name: "וואן פיס ישראל",
      poster: "https://animeisrael.co.il/wp-content/uploads/2023/05/s-l1200-1.webp",
      background: "https://animeisrael.co.il/wp-content/uploads/2023/05/s-l1200-1.webp",
      description: 'וואן פיס בעברית - כל הפרקים מתורגמים. מתורגם ע"י onepiece-nakama.com',
      releaseInfo: "1999-2024",
      genres: ["אנימה", "שונן", "הרפתקאות"],
      videos,
    },
  });
});

builder.defineStreamHandler(({ type, id }) => {
  if (type !== "series" || !id.startsWith(SERIES_ID))
    return Promise.resolve({ streams: [] });

  const epNum = parseInt(id.split(":")[2], 10);
  const url = EPISODES[epNum];
  if (!url) return Promise.resolve({ streams: [] });

  return Promise.resolve({
    streams: [{
      title: `פרק ${epNum} — מתורגם עברית 🇮🇱`,
      externalUrl: url.replace("/preview", "/view"),
    }],
  });
});

// --- Express server עם /ping ---
const app = express();

// ה-addon routes (manifest, catalog, meta, stream)
app.use(getRouter(builder.getInterface()));

// /ping — UptimeRobot יפנה לכאן כל 5 דקות
app.get("/ping", (_req, res) => {
  res.status(200).json({ status: "alive", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\n🏴‍☠️  וואן פיס ישראל addon רץ!`);
  console.log(`📡 manifest : http://localhost:${PORT}/manifest.json`);
  console.log(`🏓 ping     : http://localhost:${PORT}/ping`);
  console.log(`\n📺 התקנה ב-Stremio:`);
  console.log(`   https://YOUR-APP.onrender.com/manifest.json`);
});
