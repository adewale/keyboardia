# Song Maker comparison research receipt

**Captured:** 2026-08-04

**Live revalidation:** 2026-08-11. The decoded bundle was again 1,021,930
bytes with the same SHA-256 listed below. Browser inspection again showed the
direct Song Area and defaults of 4 bars, 4 beats/bar, split 2, Major, C,
Middle register, 2 octaves, 120 BPM, Marimba, and Electronic. No new source
version was introduced between the two comparison passes.

**Keyboardia comparison base:** `049e97c54fdf7053ebb2382f86053f6e2432fe58`

**Pre-audit, pre-rebase PR head inspected:**
`430e0b56557857aa119d3ad2586229f53681dc96`

This receipt makes the externally sourced observations in
`SONG-MAKER-COMPARISON-2026-08.md` repeatable. It records metadata and
hashes only; no Song Maker audio or bundle is vendored.

## Tools

- macOS `curl 8.7.1` (SecureTransport, zlib 1.2.12)
- `ffprobe 8.1.2`
- `git 2.54.0`
- `shasum` with SHA-256
- repository searches with `rg`

`exiftool` was not installed; metadata claims below come from `ffprobe`.

## External inputs and hashes

The server delivered the JavaScript response gzip-compressed. `curl
--compressed` decoded it before writing, so the bundle hash below is for the
decoded bytes, not the compressed wire representation.

| Input | Bytes | SHA-256 |
|---|---:|---|
| `https://musiclab.chromeexperiments.com/Song-Maker/client/build/Main.js` (decoded response) | 1,021,930 | `d855d8e785f2e478fc3e4fb7956b4f6b716670dbdf3adc72a1a1bc5ad287ef1e` |
| `https://musiclab.chromeexperiments.com/Song-Maker/client/audio/marimba/C4.mp3` | 40,256 | `5adf0b43f9b3bbdcdca4ebbf95258f256e75a89c348d46654c864823855c2d8f` |
| `https://musiclab.chromeexperiments.com/Song-Maker/client/audio/strings/C4.mp3` | 56,102 | `d5fea64886cdd8eca3b79676012d7729ece26da4e3c0fae574b4bb1343fd5c77` |

Representative `ffprobe` results:

| Asset | Codec | Sample rate | Channels | Stream bit rate | Duration |
|---|---|---:|---:|---:|---:|
| marimba C4 | MP3 | 44,100 Hz | 2 (stereo) | 128,000 bit/s | 2.066938 s |
| strings C4 | MP3 | 44,100 Hz | 2 (stereo) | 128,000 bit/s | 3.057313 s |

The marimba file's XMP includes `bext:originator="Pro Tools"`,
`xmp:CreateDate="2018-02-26T18:25:35-05:00"`, and
`bext:originationDate="2018-02-26"`; the encoder history names Adobe Media
Encoder CC 2015.4. These fields describe an asset-processing history. They
do not establish ownership, commissioning, product-specific creation, or
the provenance of the whole library.

## Reproduction commands

Run from a Keyboardia checkout. Set `RECEIPT_DIR` to an empty temporary
directory first.

```sh
curl -sS -L --compressed \
  https://musiclab.chromeexperiments.com/Song-Maker/client/build/Main.js \
  -o "$RECEIPT_DIR/Main.dec.js"
curl -sS -L \
  https://musiclab.chromeexperiments.com/Song-Maker/client/audio/marimba/C4.mp3 \
  -o "$RECEIPT_DIR/marimba-C4.mp3"
curl -sS -L \
  https://musiclab.chromeexperiments.com/Song-Maker/client/audio/strings/C4.mp3 \
  -o "$RECEIPT_DIR/strings-C4.mp3"

shasum -a 256 \
  "$RECEIPT_DIR/Main.dec.js" \
  "$RECEIPT_DIR/marimba-C4.mp3" \
  "$RECEIPT_DIR/strings-C4.mp3"

ffprobe -v error \
  -show_entries stream=codec_name,sample_rate,channels,channel_layout,duration,bit_rate \
  -show_entries format=duration,size,bit_rate \
  -of json "$RECEIPT_DIR/marimba-C4.mp3"
ffprobe -v error -show_entries format_tags -of json \
  "$RECEIPT_DIR/marimba-C4.mp3"
```

The decoded bundle was searched for the sample roots
`["C","Ds","Fs","A"]`, octaves 2–6, the five tonal instrument names,
the model defaults, sampler constructor gain branches, release/fade values,
and the tonal velocity expression. Because the bundle is minified and its
URL is mutable, future reproductions should treat a hash mismatch as a new
source version and re-trace call sites rather than assuming line offsets.

Keyboardia claims were checked against the pinned base SHA with repository
searches and direct source reads. In particular:

```sh
git show 049e97c54fdf7053ebb2382f86053f6e2432fe58:app/src/audio/synth-types.ts
git show 049e97c54fdf7053ebb2382f86053f6e2432fe58:app/src/audio/synth.ts
git show 049e97c54fdf7053ebb2382f86053f6e2432fe58:app/src/shared/session-defaults.ts
git show 049e97c54fdf7053ebb2382f86053f6e2432fe58:app/src/shared/midi-core.ts
git show 049e97c54fdf7053ebb2382f86053f6e2432fe58:app/src/audio/track-bus-manager.ts
```

The checked-in MP3 inventory was measured with:

```sh
rg --files app/public | rg '\.mp3$' | while IFS= read -r asset; do
  ffprobe -v error -select_streams a:0 \
    -show_entries stream=sample_rate,channels,bit_rate -of csv=p=0 "$asset"
done | sort | uniq -c
```

At the pinned checkout this returned 180 assets: 22 mono/44.1 kHz,
154 stereo/44.1 kHz, and four mono/48 kHz; all reported 128,000 bit/s.

## Limits

- This is source/metadata inspection, not a controlled comparative audio
  capture. Claims about audibility, timing parity, pumping magnitude, and
  subjective quality remain hypotheses until Phase 43.0 measurements.
- Only two representative Song Maker tonal assets were downloaded for the
  hash/metadata table. Do not generalize their metadata to every asset
  without extending the receipt.
- A missing attribution in the inspected materials is not evidence that an
  asset is unlicensed, bespoke, or available for reuse.
- Live URLs can change. Keep the date, decoded-vs-wire distinction, and
  hashes with any later update.
