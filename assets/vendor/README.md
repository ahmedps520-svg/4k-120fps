# Vendored dependencies

Served from this repository rather than a CDN, so the page makes no third-party
requests and keeps working offline.

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `mp4box.all.min.js` | [mp4box](https://github.com/gpac/mp4box.js) | 0.5.2 | BSD-3-Clause (`mp4box.LICENSE`) |
| `mp4-muxer.js` | [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | 5.2.2 | MIT (`mp4-muxer.LICENSE`) |

Both are loaded lazily, only when someone starts a conversion in the page.
`mp4box` demuxes the input MP4; `mp4-muxer` writes the output MP4 around the
chunks produced by the browser's `VideoEncoder`.
