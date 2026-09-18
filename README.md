# TikTok Upload Prep

A static, browser-only tool for getting video onto TikTok in the best condition
the platform will allow — built for people working from an iPhone with no
computer available.

**Live:** https://ahmedps520-svg.github.io/4k-120fps/

## The premise, stated honestly

TikTok re-encodes every upload on its servers. That happens after the file
arrives and cannot be disabled by any setting, format or upload route. This
project does not claim to bypass it.

What it does is control the input to that encode. A file at the right resolution
and frame rate, with enough bitrate and no prior compression, survives one encode
almost unchanged. A file already squeezed by a phone app and then edited inside
TikTok has been through three or four. That gap is most of what people mean when
they say their uploads look bad.

## What it does

- **Question flow** — five questions (source format, upload route, what the extra
  frames should become, clip length, quality priority) that drive every number
  used elsewhere on the page.
- **Analyzer** — reads resolution, duration, size and average bitrate from a local
  file, and measures the true frame rate from per-frame presentation timestamps
  via `requestVideoFrameCallback`. Flags landscape sources, sub-1080p sources and
  footage that has already been compressed.
- **Method A — Shortcuts** — generated step-by-step instructions for the iOS
  Shortcuts `Encode Media` action, which uses Apple's hardware encoder. Values
  come from the answers above.
- **Method B — in-page conversion** — a WebCodecs transcode pipeline: `mp4box`
  demux → `VideoDecoder` → frame retiming and letterboxed scaling on a canvas →
  `VideoEncoder` → `mp4-muxer`, with the index written at the front. This is the
  only on-device way to change frame rate precisely.
- **Method C — FFmpeg** — commands for libx264, VideoToolbox and NVENC, plus an
  export settings sheet, for when a computer is available.
- **Upload steps** for the desktop site from Safari, and notes covering the
  questions this raises.

## Frame rate is the interesting part

Playback tops out at 60fps, so 120fps source frames are a budget rather than a
feature. The tool makes the choice explicit:

| Choice | How it is done | Result |
| --- | --- | --- |
| Normal speed, 60fps | every second frame kept | smooth real time, audio untouched |
| Half speed | `setpts` ×2 / retimed to a 60fps grid | every frame used, audio removed |
| Quarter speed | `setpts` ×4 / retimed to a 30fps grid | every frame used, audio removed |
| Normal speed, 30fps | even reduction | most bitrate per remaining frame |

Method B implements this by mapping each decoded frame's presentation time onto
the output frame grid and keeping the first frame that lands in each slot, so
conforming and slow motion are the same operation with a different multiplier.

## Privacy

No backend, no upload endpoint, no analytics, no third-party requests. The two
libraries method B needs are vendored in `assets/vendor/` and loaded lazily, only
when a conversion starts.

## Tested

The conversion pipeline is verified end to end in headless Chromium against a
generated 120fps clip: conform to 60fps produces 121 frames over 2.02s, half
speed produces all 240 frames over 4.00s, 30fps produces 61 frames, and a
non-9:16 target letterboxes without cropping.

Two things could not be exercised in that environment, because it ships without
H.264 and the egress policy blocks `github.io`:

- the H.264 encode and decode path specifically (the pipeline was proven with
  VP9 instead), and
- loading the deployed page.

Method B therefore probes `VideoEncoder.isConfigSupported` and
`VideoDecoder.isConfigSupported` on the visitor's own device and reports what it
finds before offering the button, rather than assuming support and failing
mid-conversion. Method A does not depend on any of it.

## Running locally

No build step:

```sh
python3 -m http.server 8000
```

## Deployment

Pushing to `main` runs `.github/workflows/pages.yml`, which publishes the
repository root to GitHub Pages.

---

Not affiliated with or endorsed by TikTok or ByteDance. Menu paths and upload
limits change between app versions and regions.
