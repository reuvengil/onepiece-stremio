/**
 * copy-to-drive.js
 * Copies all One Piece episodes from animeisrael's Drive to your personal Drive
 * using server-side copy (no bandwidth used on your end)
 * 
 * Setup:
 *   1. Place credentials.json (OAuth2) in same folder
 *   2. npm install googleapis
 *   3. node copy-to-drive.js
 * 
 * Output: one-piece-links-mine.json with your new file IDs
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CREDENTIALS_FILE = "credentials.json";
const TOKEN_FILE = "token.json";
const INPUT_FILE = "one-piece-links.json";
const OUTPUT_FILE = "one-piece-links-mine.json";
const PROGRESS_FILE = "copy-progress.json";
const FOLDER_NAME = "One Piece Israel";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

// --- Auth ---
async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE));
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_FILE)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_FILE)));
    return oAuth2Client;
  }

  // First time — open browser for auth
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
  console.log("\n🔐 Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => {
    rl.question("Paste the authorization code here: ", (c) => { rl.close(); resolve(c.trim()); });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
  console.log("✅ Token saved\n");
  return oAuth2Client;
}

// --- Create folder in your Drive ---
async function getOrCreateFolder(drive, folderName) {
  // Check if folder already exists
  const existing = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
  });

  if (existing.data.files.length > 0) {
    console.log(`📁 Folder already exists: ${folderName} (${existing.data.files[0].id})`);
    return existing.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  console.log(`📁 Created folder: ${folderName} (${folder.data.id})`);
  return folder.data.id;
}

// --- Copy single file ---
async function copyFile(drive, fileId, episodeNum, folderId) {
  const response = await drive.files.copy({
    fileId,
    requestBody: {
      name: `One_Piece_${String(episodeNum).padStart(4, "0")}`,
      parents: [folderId],
    },
    fields: "id, name",
  });
  return response.data.id;
}

// --- Load progress ---
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return {};
  return JSON.parse(fs.readFileSync(PROGRESS_FILE));
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Main ---
async function main() {
  console.log("🏴‍☠️  One Piece — Copy to your Google Drive\n");

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error("❌ credentials.json not found! Follow setup instructions.");
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_FILE)) {
    console.error("❌ one-piece-links.json not found! Run npm run crawl first.");
    process.exit(1);
  }

  const auth = await authorize();
  const drive = google.drive({ version: "v3", auth });

  // Create/find folder
  const folderId = await getOrCreateFolder(drive, FOLDER_NAME);

  // Load episodes
  const data = JSON.parse(fs.readFileSync(INPUT_FILE));
  const episodes = data.episodes.filter((e) => e.url);
  console.log(`\n📋 ${episodes.length} episodes to copy\n`);

  // Load progress (resume if interrupted)
  const progress = loadProgress();
  const alreadyCopied = Object.keys(progress).length;
  if (alreadyCopied > 0) {
    console.log(`⏩ Resuming — ${alreadyCopied} already copied\n`);
  }

  let copied = 0;
  let failed = 0;

  for (const ep of episodes) {
    const fileIdMatch = ep.url.match(/\/file\/d\/([^/]+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;
    if (!fileId) continue;

    // Skip already copied
    if (progress[ep.episode]) {
      continue;
    }

    try {
      const newFileId = await copyFile(drive, fileId, ep.episode, folderId);
      progress[ep.episode] = {
        episode: ep.episode,
        originalFileId: fileId,
        newFileId,
        url: `https://drive.google.com/file/d/${newFileId}/preview`,
      };

      saveProgress(progress);
      copied++;

      const pct = (((alreadyCopied + copied) / episodes.length) * 100).toFixed(1);
      console.log(`✅ Episode ${String(ep.episode).padStart(4)} → ${newFileId} (${pct}%)`);

      // Small delay to avoid rate limiting
      await sleep(300);
    } catch (err) {
      failed++;
      console.error(`❌ Episode ${ep.episode}: ${err.message}`);

      // If rate limited — wait longer
      if (err.message.includes("rate") || err.message.includes("429")) {
        console.log("⏳ Rate limited, waiting 10 seconds...");
        await sleep(10000);
      }
    }
  }

  // Build output JSON
  const allCopied = { ...progress };
  const outputEpisodes = Object.values(allCopied)
    .sort((a, b) => a.episode - b.episode)
    .map(({ episode, url }) => ({ episode, url }));

  const output = {
    generated_at: new Date().toISOString(),
    total_episodes: outputEpisodes.length,
    folder_id: folderId,
    episodes: outputEpisodes,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Done!`);
  console.log(`📁 Folder ID  : ${folderId}`);
  console.log(`✅ Copied      : ${copied}`);
  console.log(`⏩ Skipped     : ${alreadyCopied}`);
  console.log(`❌ Failed      : ${failed}`);
  console.log(`💾 Saved to    : ${OUTPUT_FILE}`);
  console.log(`\n👉 Now replace one-piece-links.json with one-piece-links-mine.json`);
  console.log(`   and push to GitHub to update the addon.`);
}

main().catch(console.error);
