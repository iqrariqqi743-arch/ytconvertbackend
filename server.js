const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "YTConvert Node.js backend is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
  });
});

app.post("/convert", async (req, res) => {
  const { url, quality = "192" } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      success: false,
      message: "YouTube URL is required",
    });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({
      success: false,
      message: "Invalid URL",
    });
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  const allowedHosts = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ];

  if (parsedUrl.protocol !== "https:" || !allowedHosts.includes(hostname)) {
    return res.status(400).json({
      success: false,
      message: "Only HTTPS YouTube URLs are allowed",
    });
  }

  const allowedQualities = ["128", "192", "256", "320"];

  if (!allowedQualities.includes(String(quality))) {
    return res.status(400).json({
      success: false,
      message: "Invalid MP3 quality",
    });
  }

  const tempDir = path.join(os.tmpdir(), `ytconvert-${randomUUID()}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    const outputTemplate = path.join(tempDir, "audio.%(ext)s");

    const args = [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "--max-filesize",
      "100M",
      "--socket-timeout",
      "20",
      "--retries",
      "2",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      `${quality}K`,
      "--output",
      outputTemplate,
      url,
    ];

    await new Promise((resolve, reject) => {
      const child = spawn("yt-dlp", args, {
        windowsHide: true,
      });

      let errorOutput = "";
      let finished = false;

      const timeout = setTimeout(() => {
        child.kill();
        if (!finished) {
          finished = true;
          reject(new Error("Conversion timed out"));
        }
      }, 180000);

      child.stderr.on("data", (chunk) => {
        errorOutput += chunk.toString().slice(-2000);
      });

      child.on("error", (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeout);
          reject(error);
        }
      });

      child.on("close", (code) => {
        if (finished) return;

        finished = true;
        clearTimeout(timeout);

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(errorOutput || "yt-dlp conversion failed"));
        }
      });
    });

    const mp3Path = path.join(tempDir, "audio.mp3");

    await fs.promises.access(mp3Path);

    res.download(mp3Path, "YTConvert.mp3", async () => {
      await fs.promises
        .rm(tempDir, {
          recursive: true,
          force: true,
        })
        .catch(() => {});
    });
  } catch (error) {
    await fs.promises
      .rm(tempDir, {
        recursive: true,
        force: true,
      })
      .catch(() => {});

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`YTConvert backend running on port ${PORT}`);
});
