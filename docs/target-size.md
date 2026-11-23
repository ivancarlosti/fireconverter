# Target size

**Target size** (also called a *size cap*) means: produce a file at or below the
number you choose, instead of asking for a quality level and hoping.

The UI label is **Target size** because it describes the goal rather than the
mechanism. The review dialog calls the value a **size cap** to make the hard
limit explicit.

## Plan first, encode second

Every target-size job has two phases:

1. **Plan** — duration and streams are probed and bitrates (or an image search
   strategy) are calculated. The review dialog shows the plan.
2. **Encode** — the plan is executed. The result is measured; if it is over the
   cap, one retry lowers the bitrate by 15%. A result that still overshoots is
   rejected instead of handed over.

This is why a target-size conversion sometimes takes a moment longer: the plan
is shown before the expensive work starts.

## The formula

Constants:

| Constant | Value | Purpose |
| :-- | :-- | :-- |
| Container reserve | 3% | muxer, frame index, headers |
| Minimum video | 50 kbps | below this the result is unusable |
| Audio range | 8–320 kbps | lossy audio limits |
| Audio share | ≤ 25% of budget | prevents audio from starving video |

For a duration `d` seconds and target `T` bytes:

```
total_kbps = T × 8 / d / 1000 × 0.97
```

### Audio

```
audio_kbps = clamp(floor(total_kbps), 8, 320)
```

If `total_kbps < 8`, the target is rejected and the minimum is reported.
Lossless outputs (WAV, FLAC) reject target mode entirely.

### Video

```
audio_kbps = min(requested, floor(total_kbps × 0.25), 320)
if audio_kbps < 32: audio_kbps = 0          # no room for a track
video_kbps = floor(total_kbps) - audio_kbps
if video_kbps < 50: reject with minimum
```

The video target uses two-pass ABR:

- MP4/MOV/MKV: `libx264` + AAC
- WebM: `libvpx-vp9` + Opus

`-maxrate` is 1.45× the target bitrate and `-bufsize` is 2×, which keeps peaks
inside the plan.

### Images

Images have no duration, so the search is different:

1. Render at the requested dimensions.
2. For JPEG/WebP/AVIF, binary-search quality between 0.05 and 0.95 (7 steps).
3. If even 0.05 is too large, shrink dimensions by 22% and repeat (up to 5
   times).
4. PNG has no quality knob, so only dimensions shrink.

The first result under the cap is kept; it is the highest quality that fits.

## Worked examples

### 4-second video, 0.5 MB cap

```
total = 500,000 × 8 / 4 / 1000 × 0.97 = 970 kbps
audio = min(96, 242) = 96 kbps
video = 970 - 96 = 874 kbps
```

The integration test produced **476,759 bytes** for a 500,000-byte cap:
H.264 1280×720 + AAC, 4.02 s.

### 60-second audio, 1 MB cap

```
total = 1,000,000 × 8 / 60 / 1000 × 0.97 = 129 kbps
```

MP3 at ~129 kbps gives roughly 970 KB after headers.

### 4-second audio, 0.05 MB cap

```
total = 50,000 × 8 / 4 / 1000 × 0.97 = 97 kbps
```

The local engine produced a ~48 KB MP3 and reported it as done. If the target
were 0.01 MB, the plan would reject it because 8 kbps over 4 s is the floor.

## Minimum target

When a target is impossible, the error is `target_too_small` and the message
includes the minimum size in MB. That minimum is:

```
bytes = (minimum_kbps × 1000 / 8 × duration) / 0.97
```

For video the minimum includes the audio reserve; for audio it is 8 kbps.

## Precision and honesty

- The cap is checked in bytes, not estimated from bitrate. Audio CBR and
  two-pass video usually land within 1–3% below the cap.
- A retry at 85% is used when the first pass overshoots. The result records a
  `target_retried` warning.
- A file that still cannot fit is **not** returned. This is stricter than
  converters that only aim approximately.
- The target is a **ceiling**, not a quota. A 2 MB target on a 300 KB source
  may legitimately produce a smaller file; the review dialog warns when the
  target exceeds the source.
- Very large targets can hit codec limits; the planner caps audio at 320 kbps
  and warns with `target_above_codec_max`.

## Why not just CRF?

CRF is quality-driven: the size is whatever the content needs. Target-size mode
answers a different question — "this attachment limit is 8 MB, make it fit" —
and therefore needs bitrate math plus verification. FireConverter keeps both
modes because CRF is still the better choice when quality matters more than a
number.
