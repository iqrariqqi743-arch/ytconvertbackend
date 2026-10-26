
import asyncio
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

app = FastAPI(title="YTConvert API")


class ConvertRequest(BaseModel):
    url: str
    quality: str = "192"


@app.get("/")
def home():
    return {
        "success": True,
        "message": "YTConvert API running"
    }


def get_video_id(url):
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()

    if parsed.scheme not in ("http", "https"):
        return None

    if host in ("youtu.be", "www.youtu.be"):
        video_id = parsed.path.strip("/").split("/")[0]

    elif host in ("youtube.com", "www.youtube.com", "m.youtube.com"):
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith("/shorts/"):
            video_id = parsed.path.split("/")[2]
        else:
            return None
    else:
        return None

    import re
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return None

    return video_id


def download_mp3(video_id, quality):
    folder = tempfile.mkdtemp(prefix="ytconvert_")

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(Path(folder) / "audio.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "socket_timeout": 20,
        "retries": 1,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": quality,
        }],
    }

    try:
        url = f"https://www.youtube.com/watch?v={video_id}"

        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.extract_info(url, download=True)

        mp3_files = list(Path(folder).glob("*.mp3"))

        if not mp3_files:
            raise RuntimeError("MP3 file was not created")

        return folder, mp3_files[0]

    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise


@app.post("/convert")
async def convert(request: ConvertRequest):
    video_id = get_video_id(request.url)

    if not video_id:
        raise HTTPException(
            status_code=400,
            detail="Invalid YouTube URL"
        )

    if request.quality not in ("128", "192", "320"):
        raise HTTPException(
            status_code=400,
            detail="Invalid audio quality"
        )

    try:
        folder, mp3_path = await asyncio.to_thread(
            download_mp3,
            video_id,
            request.quality
        )

        return FileResponse(
            path=str(mp3_path),
            media_type="audio/mpeg",
            filename="ytconvert.mp3",
            background=BackgroundTask(
                shutil.rmtree,
                folder,
                ignore_errors=True
            )
        )

    except Exception as error:
        print("Conversion error:", error)
        raise HTTPException(
            status_code=502,
            detail="Unable to convert this video"
        )
