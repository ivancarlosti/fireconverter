# Formats

## Images (browser only)

| Direction | Formats |
| :-- | :-- |
| Input | PNG, JPEG/JPG/JPE/JFIF, WebP, AVIF, GIF (first frame), BMP, SVG, ICO |
| Output | WebP, JPEG, PNG, AVIF (when the browser can encode it) |

- Canvas decodes the input and re-encodes the output; EXIF orientation is
  applied through `createImageBitmap(..., { imageOrientation: 'from-image' })`.
- Animated GIF/WebP inputs are flattened to the first frame.
- SVG is rasterised at its intrinsic size, then resized.
- Metadata (EXIF, ICC, XMP) is not copied; Canvas writes a clean file.
- AVIF support is detected by encoding a 2×2 canvas. On browsers without an
  AVIF encoder the option is hidden and the default falls back to WebP.
- TIFF and HEIC are not listed: the browser cannot decode them without an extra
  wasm codec. Convert them to PNG/JPEG first.

## Audio (browser only)

| Direction | Formats |
| :-- | :-- |
| Input | MP3, WAV, FLAC, OGG, OGA, Opus, AAC, M4A, M4B, ALAC, WMA, AIFF/AIF/AIFC, AC3, MP2, AU, VOC, TTA |
| Output | MP3, M4A (AAC), AAC (ADTS), OGG (Vorbis), Opus, FLAC, WAV |

Encoder pairs:

| Output | Codec | Target size |
| :-- | :-- | :--: |
| MP3 | libmp3lame | yes |
| M4A | AAC | yes |
| AAC | AAC/ADTS | yes |
| OGG | libvorbis | yes |
| Opus | libopus | yes |
| FLAC | flac | no |
| WAV | pcm_s16le | no |

## Video

The same input and output catalogue is used by the browser and the server.

| Direction | Formats |
| :-- | :-- |
| Input | MP4, MKV, MOV, WebM, AVI, M4V, MTS, TS, M2TS, FLV, F4V, WMV, 3GP, 3G2, OGV, MPG/MPEG, VOB, MXF, GXF, NUT, DIVX, ASF, Y4M, IVF, H264 |
| Output | MP4, WebM, MKV, MOV, GIF, MP3 (audio extraction) |

Encoder pairs:

| Output | Video | Audio | Target size |
| :-- | :-- | :-- | :--: |
| MP4 | libx264 | AAC | yes |
| MOV | libx264 | AAC | yes |
| MKV | libx264 | AAC | yes |
| WebM | libvpx-vp9 | libopus | yes |
| GIF | gif (palette filter) | none | no |
| MP3 | none | libmp3lame | n/a (audio) |

### Container notes

- MP4/MOV/M4A get `-movflags +faststart` for progressive playback.
- H.264 requires even dimensions; the scale filter enforces them.
- GIF is limited to 12 fps by design; use WebM/MP4 for smooth video.
- The server probes the first non-album-art video stream and the first audio
  stream. Files without the required stream are rejected with `no_video` or
  `no_audio`.
- Target-size encoding is two-pass ABR. The server reserves 3% for container
  overhead and verifies the final byte count.

## Target-size support summary

| Category | Supported | Notes |
| :-- | :-- | :-- |
| Image | JPEG, PNG, WebP, AVIF | Quality search; PNG reduces dimensions only. |
| Audio | MP3, M4A, AAC, OGG, Opus | Bitrate from duration; lossless rejected. |
| Video | MP4, MOV, MKV, WebM | Two-pass H.264/VP9; GIF and MP3 extraction rejected. |

## Why this set?

The browser engines are intentionally honest about what they can do:

- Canvas outputs cover the formats browsers can both decode and encode;
- ffmpeg.wasm covers the common audio/video containers without shipping a
  100 MB multi-codec build;
- the server adds exactly the video outputs that are universally playable.

Adding a format means adding it to both the UI catalogue
(`web/src/lib/formats.ts`) and the server registry
(`internal/convert/formats.go`), plus a codec pair and a test.
