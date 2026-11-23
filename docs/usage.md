# Usage

## The workflow

1. **Add files** — drag them onto the dropzone or click *Choose files*. Up to 50
   files per queue.
2. **Pick an output** per file. The default comes from *Preferences*; changing
   it never affects other cards.
3. **Choose a mode** — *Quality* or *Target size*.
4. **Press Convert** (or *Convert all*). Target-size jobs open a review dialog
   first.
5. **Download** the result. Local results stay in memory until the card is
   removed or the page is reloaded.

## Engines

| Category | Engine | Where the file goes |
| :-- | :-- | :-- |
| Image | Canvas | Nowhere; it is decoded and re-encoded in the tab. |
| Audio | ffmpeg.wasm | Nowhere; the engine is downloaded once and cached by the browser. |
| Video | ffmpeg.wasm | Nowhere. The ~31 MB engine is downloaded on first use. |
| Video | Server ffmpeg | Uploaded to this instance, converted, downloadable for `JOB_TTL_MINUTES`, then erased. |

Images and audio are deliberately local-only: the server rejects image uploads
with `image_local` and the UI never offers a server engine for them.

## Quality mode

- **Image** — a 1–100 quality slider for JPEG/WebP/AVIF. PNG ignores quality.
- **Audio** — the bitrate (96–320 kbps). FLAC and WAV ignore it.
- **Video** — *High* (CRF 18), *Balanced* (CRF 23) or *Small* (CRF 28) for
  H.264; the VP9 equivalent is shifted for its 0–63 range.

## Target-size mode

Enter a size in MB and press Convert. A dialog shows the plan before anything is
encoded. See [target-size.md](target-size.md) for the formula.

- The result is verified after encoding.
- If the muxer overshoots, FireConverter retries once at a lower bitrate.
- If the target is impossible, the error includes the smallest reachable size.
- Lossless outputs (WAV/FLAC) and GIF do not offer target size.

## Resize and scale

Image cards have an *Advanced* section:

- **Width/Height** — one value keeps the aspect ratio, two values use the
  selected fit.
- **Contain** — fit inside the box, output dimensions follow the source aspect.
- **Cover** — fill the box and crop the overflow.
- **Stretch** — fill the box and distort.
- **Do not upscale** — never produce a larger image than the source.
- **Background** — fills transparency when the output is JPEG.

Video cards have an optional resolution (`1280x720`) and frame rate. The scale
filter preserves the aspect ratio and forces even dimensions for H.264.

## Cancel, remove, retry

- **Cancel conversion** stops the running local engine or asks the server to
  cancel the job.
- Removing a card also deletes its server job and revokes local object URLs.
- Failed or cancelled cards can be retried without re-adding the file.

## Preferences

The gear icon opens defaults for new files:

- image format and quality;
- audio format and bitrate;
- video format, quality preset and engine;
- automatic download.

Preferences live in `localStorage['fireconverter.preferences.v1']` on the
device. They never leave the browser.

## Privacy

- Images and audio are processed in the tab. There is no upload request.
- Video is uploaded only when *This server* is selected.
- The server stores the upload in `WORK_DIR`, erases the input after encoding
  and the output after the TTL. Job IDs are random 128-bit hex values.
- No account, analytics, telemetry or third-party fonts are used.

## Browser support

The app targets current Chromium, Firefox and Safari. AVIF encoding is
feature-detected. SharedArrayBuffer is not required: the single-thread ffmpeg core
works over plain HTTP on a LAN as well as HTTPS. Local video is CPU-bound; a
short 320×180 clip is a good first test.

## Troubleshooting

| Symptom | Fix |
| :-- | :-- |
| *Server conversion is unavailable* | Start the Docker image (it includes ffmpeg) or install `ffmpeg`/`ffprobe` on the host. Local conversion still works. |
| Local engine fails to load | Check that `/ffmpeg/ffmpeg-core.wasm` returns `200 application/wasm`; a proxy must not strip it or change the content type. |
| Local engine fails after an upgrade; the console shows `sw.js` serving from cache | An old service worker from a previous deployment is still installed. DevTools → Application → Service Workers → **Unregister**, then Application → Storage → **Clear site data** (this also resets preferences; deleting just the Cache Storage entries is enough), close every FireConverter tab and reopen. Current builds serve a self-removing `/sw.js`; the next update check clears old registrations automatically. If the script URL starts with `chrome-extension://`, disable that extension instead. |
| Console shows `A listener indicated an asynchronous response…` | A browser extension is using `chrome.runtime` messaging; it is unrelated to conversion. Disable extensions or retry in a clean profile to confirm. |
| `target_too_small` | Increase the target; the error reports the minimum. |
| `target_missed` | The encoder could not reach the cap even after retrying; increase the target slightly. |
| Upload rejected with `too_large` | Raise `MAX_UPLOAD_MB` or use the local engine. |
| Result disappears after an hour | `JOB_TTL_MINUTES` expired; reconvert. |
