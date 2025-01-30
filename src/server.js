import express from "express";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  addTemporaryRecord,
  getTemporaryRecord,
  removeTemporaryRecord
} from "./storage.js";
import { getBestStreamForMedia } from "./providers.js";
import { getBackupHlsForMedia } from "./backup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 3000,
  BASE_URL,
  SECRET_KEY = "supersecret"
} = process.env;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Savingshub.watch server is running!");
});

/**
 * Creates a short-lived link storing the chosen media data in memory.
 */
export async function createStreamLink({ type, tmdbId, title, seasonNum, episodeNum }) {
  console.log("DEBUG: createStreamLink with:", { type, tmdbId, title, seasonNum, episodeNum });

  // Generate a random token
  const token = crypto.randomBytes(6).toString("hex");
  const randomLetters = crypto.randomBytes(3).toString("hex");

  // The record stored in memory for /play to reference
  const record = {
    type,
    tmdbId,
    title,
    seasonNum,
    episodeNum,
    createdAt: Date.now()
  };
  console.log("DEBUG: Storing record with token:", token, record);

  // Expires in 3 hours
  addTemporaryRecord(token, record, 3 * 60 * 60 * 1000);

  // Build the user-facing URL
  const slugTitle = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
  const watchUrl = `${BASE_URL}/${randomLetters}-${slugTitle}?token=${token}`;

  console.log("DEBUG: watchUrl ->", watchUrl);
  return { watchUrl, token };
}

export async function createBackupLink({ type, tmdbId, title, seasonNum, episodeNum }) {
  console.log("DEBUG: createBackupLink with:", { type, tmdbId, title, seasonNum, episodeNum });

  // Generate a random token
  const token = crypto.randomBytes(6).toString("hex");
  // random ID used in the final link
  const randomLetters = crypto.randomBytes(3).toString("hex");

  const record = {
    isBackup: true, // so we know this record is for the backup approach
    type,
    tmdbId,
    title,
    seasonNum,
    episodeNum,
    createdAt: Date.now()
  };

  addTemporaryRecord(token, record, 3 * 60 * 60 * 1000);

  const slugTitle = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
  const watchUrl = `${BASE_URL}/backup-${randomLetters}-${slugTitle}?token=${token}`;
  console.log("DEBUG: watchUrl ->", watchUrl);

  return { watchUrl, token };
}


// Route: /:randomPart-:titleSlug?token=XYZ
// Serves the HTML player
app.get("/:randomPart-:titleSlug", (req, res) => {
  const { token } = req.query;
  console.log("DEBUG: GET /:randomPart-:titleSlug with token=", token);

  if (!token) {
    return res.status(400).send("Missing token.");
  }
  const record = getTemporaryRecord(token);
  console.log("DEBUG: record from memory ->", record);

  if (!record) {
    return res.status(410).send("Link expired or invalid token.");
  }

  // Serve the minimal HTML page
  res.sendFile(path.join(__dirname, "views", "player.html"));
});

app.get("/backup-:randomPart-:titleSlug", (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send("Missing token.");
  }

  const record = getTemporaryRecord(token);
  if (!record) {
    return res.status(410).send("Link expired or invalid token.");
  }

  // You can serve the same player.html or a different one
  res.sendFile(path.join(__dirname, "views", "player.html"));
});

// Route: /play/:token => returns JSON with bestStream
app.get("/play/:token", async (req, res) => {
  const { token } = req.params;
  console.log("DEBUG: GET /play/:token -> token =", token);

  const record = getTemporaryRecord(token);
  console.log("DEBUG: record from memory ->", record);

  if (!record) {
    return res.status(410).json({ error: "Link expired or invalid token." });
  }

  try {
    const { type, tmdbId, seasonNum, episodeNum } = record;
    console.log("DEBUG: about to getBestStreamForMedia with:", record);

    const bestStream = await getBestStreamForMedia({ type, tmdbId, seasonNum, episodeNum });
    console.log("DEBUG: bestStream ->", bestStream);

    if (!bestStream) {
      return res.status(404).json({ error: "No suitable stream found." });
    }

    // Return JSON with the single best stream
    res.json({ bestStream });
  } catch (err) {
    console.error("ERROR in /play/:token route:", err);
    res.status(500).json({ error: "Failed to retrieve streams." });
  }
});

app.get("/play-backup/:token", async (req, res) => {
  const { token } = req.params;
  const record = getTemporaryRecord(token);

  if (!record) {
    return res.status(410).json({ error: "Link expired or invalid token." });
  }

  try {
    const { type, tmdbId, seasonNum, episodeNum } = record;

    // The new backup approach
    const bestStream = await getBackupHlsForMedia({ 
      type,
      tmdbId,
      seasonNum,
      episodeNum,
      title: record.title
    });

    if (!bestStream) {
      return res.status(404).json({ error: "No suitable backup stream found." });
    }

    // Return it in the same shape you do for your main approach
    res.json({ bestStream });
  } catch (err) {
    console.error("ERROR in /play-backup/:token route:", err);
    res.status(500).json({ error: "Failed to retrieve backup streams." });
  }
});


// Example: /api/<authToken>/<type>/<title>/<season?>/<episode?>
app.get("/api/:authToken/:type/:title/:season?/:episode?", async (req, res) => {
  const { authToken, type, title, season, episode } = req.params;
  console.log("DEBUG: /api params ->", req.params);

  if (authToken !== SECRET_KEY) {
    return res.status(403).json({ error: "Invalid auth token" });
  }

  try {
    const { watchUrl, token } = await createStreamLink({
      type,
      tmdbId: "placeholderTMDB",
      title,
      seasonNum: season ? parseInt(season, 10) : null,
      episodeNum: episode ? parseInt(episode, 10) : null
    });

    
    res.json({ watchUrl, token });
  } catch (err) {
    console.error("ERROR in /api route:", err);
    res.status(500).json({ error: "Failed to generate link." });
  }
});

export function startServer() {
  app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
  });
}
