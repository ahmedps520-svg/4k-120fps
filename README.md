# NoSquish

A static, no-backend web tool for preparing 4K / 120fps footage for TikTok so the
platform's unavoidable re-encode costs you as little quality as possible.

**Live site:** https://ahmedps520-svg.github.io/4k-120fps/

## The honest premise

There is no way to upload to TikTok without compression. Every upload is
transcoded server-side into TikTok's own delivery ladder — no website, app or
trick disables that. Anything claiming otherwise is wrong.

What is genuinely controllable is *what that encoder receives*. A clean,
high-bitrate, correctly-sized, correctly-framerated file survives one generation
of encoding almost invisibly. A phone-app export with in-app stickers burned in
has already been through two or three generations before TikTok even starts. This
tool closes that gap.

## What it does

| Section | What it is |
| --- | --- |
| Question flow | Six questions — source format, upload path, what to do with 120fps, in-app editing, clip length, quality-vs-size priority — that drive every number in the recipe. |
| Analyzer | Drop a video in; it reads resolution, duration, size and average bitrate, and **measures the true frame rate** by sampling per-frame presentation timestamps via `requestVideoFrameCallback`. Then it grades the file against TikTok's delivery reality. |
| Recipe | A generated spec card plus copy-paste FFmpeg commands for CPU (libx264), Apple silicon (VideoToolbox) and NVIDIA (NVENC), plus a field-by-field settings sheet for Premiere / Resolve / Final Cut. |
| Converter | Optional in-browser transcode via `ffmpeg.wasm`, with an upfront warning that it is far slower than the desktop command and memory-limited on large 4K files. |
| Steps | The eight-step upload procedure, including the "high quality uploads" toggle and why the web uploader beats the app. |
| FAQ | Straight answers, including why "no compression" is not achievable. |

## Privacy

The video never leaves the browser. There is no backend, no upload endpoint and
no analytics. The analyzer works with a local object URL; the optional converter
runs FFmpeg compiled to WebAssembly in the same tab. The only network requests
after page load are for the FFmpeg WebAssembly build, and only if you click
convert.

## Key technical choices

- **120fps is treated as a budget, not a feature.** TikTok playback caps at 60fps,
  so the tool makes you choose deliberately — conform to 60 (clean 2:1 decimation),
  or stretch to 2×/4× slow motion (`setpts`, every frame used, audio dropped) —
  rather than letting the platform transcoder discard frames arbitrarily.
- **4K only when uploading from desktop.** Through the phone app the file gets
  pre-compressed and downscaled locally anyway, so the tool targets 1080×1920 there
  instead and says why.
- **CRF plus a bitrate ceiling**, not a fixed bitrate — quality-targeted encoding
  with `-maxrate`/`-bufsize` only to keep upload size sane.
- **2-second keyframe interval, BT.709 tagging, `+faststart`, `yuv420p`** — the
  unglamorous metadata that prevents washed-out colour and slow first-frame loads.
- **`scale` + `pad`, never crop** — a non-9:16 source is letterboxed rather than
  silently losing its edges.

## Running locally

It is plain HTML, CSS and JavaScript with no build step:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Pushing to `main` triggers `.github/workflows/pages.yml`, which publishes the
repository root to GitHub Pages. This requires **Settings → Pages → Source:
GitHub Actions** to be selected once.

---

Not affiliated with, endorsed by, or connected to TikTok or ByteDance. Platform
behaviour, menu paths and file-size limits change frequently; verify settings
paths in your own app build.
