# Fibre channel timeout demo

A fictional three-team outage that cannot be diagnosed until the logs are merged on one clock, plus a reproducible pipeline that renders a short explainer video about it. Every log line in the video comes from the generated logs or from real `loglinealign` output.

## Scenario

| Component | Location | Log | Timestamp as written | Owner |
| --- | --- | --- | --- | --- |
| `orders-api` (Spring Boot 2.7, HikariCP pool of 10) | Mumbai, UTC+05:30 | `app-mumbai.log` | `2026-09-15 13:37:22.336` | Application team |
| SQL Server 2022 on `mucsql01` | Munich, UTC+02:00 | `db-munich.log` | `2026-09-15 10:07:44.35` | Database team |
| RHEL 9 host `mucsql01` (qla2xxx HBA, dm-multipath) | Munich, UTC+02:00 | `os-munich.log` | `2026-09-15T10:07:12.418306` | OS team |

No log records an offset. Each format is how the real product writes it in this configuration: Spring Boot 2.x's default pattern, SQL Server's ERRORLOG, and an rsyslog template that keeps only the first 26 characters of the RFC 3339 time (`%timegenerated:1:26:date-rfc3339%`).

The window is 08:00 to 08:45 UTC on 2026-09-15. Four times, the fibre channel link on HBA port host8 (`0000:3b:00.1`) drops. Each time:

| Seconds after link drop | What happens | Who logs it |
| --- | --- | --- |
| 0 | `LOOP DOWN`; I/O in flight on path `sdm` stalls | OS only |
| about 9 | App queries hit the 10 s query timeout and requests hit the 5 s pool timeout; on-call is paged | App |
| 30 | SCSI command timeout: the kernel aborts the I/O and dm-multipath fails the path; I/O resumes on host7 | OS |
| about 31 | SQL Server reports I/O requests that took longer than 15 seconds (message 833) | DB |
| 38 to 68 | `LOOP UP`; path reinstated | OS |

The teams escalate in the order app, then database, then OS, which is the reverse of the causal order. The app team pages at 13:37, the database team finds nothing at 13:37 in its log (its clock reads 10:07), and the OS team's fibre channel errors at 10:07 look unrelated to an app problem "at 13:37". A plain merge makes things worse: with no offsets, everything is read as UTC and Munich sorts 3.5 hours before Mumbai.

The fix is one option per time zone:

```sh
cd sample-logs
node ../../../dist/loglinealign.js --timezone +02:00 --file-timezone app-mumbai.log +05:30 \
  app-mumbai.log db-munich.log os-munich.log | less -R
```

## The video

`make` renders the silent `build/explainer.mp4`; `make mux` adds the voiceover and writes **`build/explainer-narrated.mp4`**, the finished explainer:

| Property | Value |
| --- | --- |
| Length | 3:16 (196 s): 102.8 s explainer plus a 93.2 s browser walkthrough |
| Picture | 1920x1080, 30 fps, H.264 |
| Sound | Narration only, AAC mono 48 kHz, no music or effects |
| Subtitles | One soft English `mov_text` track, the same cues as the narration |

`make small` writes **`build/explainer-narrated-hevc.mp4`**, the same video under 10 MB for hosts with an upload limit: two-pass HEVC (tagged `hvc1` for Apple players) with 64 kbit/s AAC narration, encoded directly from `build/explainer.mp4` and the narration. The video bitrate is computed from the duration so that the file targets `SMALL_TARGET_BYTES` (9,850,000), and the build fails if the result is not under `SMALL_MAX_BYTES` (10,000,000). If the video gets longer, the bitrate drops automatically; if it ever fails the limit, lower `SMALL_TARGET_BYTES`.

`build/` is not committed, so the file is built on demand and hosted outside the repository.

The browser segment uses the actual offline application at `../../dist/loglinealign.html`. It explains that files are processed locally and never leave the computer, pointing to the app's offline badge. It loads the three sample logs, assigns their time zones, shows all three source colors together, reverses the ordering, removes file name prefixes, explains the matching options, filters on `LOOP`, and downloads `build/fc-link-filtered.log`. It then fades back to the original closing card and holds it fully visible for two seconds. The original picture and narration remain in `build/explainer-base.mp4` and `build/narration-base.wav`; appending the walkthrough does not require synthesizing the original speech again.

## Requirements

- [uv](https://docs.astral.sh/uv/) with Python 3.14 (Playwright 1.63.0 is pinned in `uv.lock`)
- Node.js 24 or newer, the built CLI at `../../dist/loglinealign.js`, and the offline app at `../../dist/loglinealign.html` (`make` builds missing distributables using the parent Makefile)
- ffmpeg with libx264, and libx265 for `make small`
- For narration only: network access to `huggingface.co` and its file CDN (`*.hf.co`) on the first run, to download the Kokoro-82M weights and voice

## Usage

```sh
make setup     # once: create the virtual environment and install Chromium for Playwright
make           # build everything that is out of date and write build/explainer.mp4
```

| Target | Result |
| --- | --- |
| `make logs` | Regenerate `sample-logs/*.log` and `sample-logs/scenario.json` |
| `make scene` | Run both merges, write scene data, original cues in `build/narration-base.vtt`, browser cues in `build/browser.vtt`, and combined cues in `build/narration.vtt` |
| `make stills` | PNG frames with burned-in narration at `TIMES` (for example `make stills TIMES="40 55"`) into `build/stills/` |
| `make video` | Silent `build/explainer.mp4`, 1920x1080, 30 fps |
| `make browser` | Capture `build/browser.mp4`, review PNGs in `build/browser-stills/`, and the actual filtered download |
| `make preview` | `build/explainer-captioned.mp4` with narration burned in, for reviewing timing without audio |
| `make narration` | `build/narration.wav`, spoken by Kokoro-82M from `build/narration.vtt` and exactly as long as the video |
| `make mux` | `build/explainer-narrated.mp4` with the narration and a soft subtitle track; `AUDIO=path/to/file` uses a recorded voiceover instead |
| `make small` | `build/explainer-narrated-hevc.mp4`, the narrated video as two-pass HEVC under 10 MB; also honors `AUDIO` |
| `make clean` | Delete `build/` |

To inspect the scene interactively, open `scene/index.html?t=58&captions=1` in a browser after `make scene`.

## Iterating

- **Narration or timing:** edit `storyboard.toml` for the original explainer or `browser-storyboard.toml` for the appended walkthrough. Segments play back to back; cue and beat times are relative to their segment. Beats drive the animation and browser actions, so move a cue and its matching beat together. `make scene` rejects overlapping cues and cues faster than `max_words_per_second`.
- **Story or log content:** edit `scenario.py` (incident times, durations) or a generator, then `make`. Narration placeholders `{app_alert_hhmm}` and `{munich_hhmm}` are recomputed from the logs; other numbers in the narration are not.
- **Visuals:** edit `scene/scene.js` or `scene/scene.css`, check with `make stills`, then `make video`.
- **Browser actions:** edit `browser_walkthrough.py`, then run `make browser` and inspect `build/browser-stills/`. Capture uses a 1440x810 browser viewport at 4/3 device scale for readable 1920x1080 output. The pointer ring is a recording overlay; application content and interactions come from the real UI. Native file-picker and download dialogs are handled by Playwright rather than depicted as simulated dialogs. The recorder checks that all three colors are visible and that the saved file contains the expected 12 matching lines in descending order without filename prefixes. Rebuild the parent web distributable with `make -C ../.. web` after changing application sources.

The log generator uses a seeded random generator, and each original explainer frame is a pure function of `t` passed to `window.seek(t)`. Browser actions are captured on a fixed frame clock with static holds, so rendering speed does not change the segment duration. The real application's processing-time readouts can vary between captures. Text uses system fonts (`system-ui`, Menlo), so appearance can differ between machines.

## Narration

`build/narration.vtt` is both the subtitle track and the voiceover script. Each cue's start is when speech begins and its end is the latest it may finish. Cues are kept at or below 2.6 words per second.

Keep sentence boundaries at cue breaks: each cue is synthesized independently, so splitting a sentence across cues can sound disconnected. The setup describes the database's location and its Linux host in separate sentences, matching the Munich and host reveals.

`append_narration.py` combines the explainer's 19 cues with 12 browser cues offset by 102.8 seconds. The closing comparison uses separate cues for the reporting order and causal order, with at least half a second of silence between the sentences, including the narrator's end margin. The two narration passes produce `build/narration-base.wav` and `build/browser.wav`; ffmpeg joins them into `build/narration.wav`. The silent videos are joined without re-encoding before the full narration and subtitles are muxed in.

The final mux explicitly sets `-movie_timescale 1000` for QuickTime/Finder compatibility. With this FFmpeg build, automatic selection produced a 48,000,000 Hz movie timescale and 64-bit edit-list durations that Apple's audio reader truncated; FFmpeg could still decode the narration, hiding the playback problem. On macOS, `afinfo build/explainer-narrated.mp4` should report the full 196-second audio duration.

`make narration` speaks the cues with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0, voice `af_heart`) on the CPU. Kokoro does not support Python 3.14, so `narrate.py` is a standalone uv script pinned to Python 3.12, with its dependencies declared inline and locked in `narrate.py.lock`; it does not use the project environment.

- **Pronunciation:** `spoken_text.py` spells out clock times by rule (`13:37` becomes "thirteen thirty-seven", `10:07` "ten oh seven") and rewrites `loglinealign` as "log line align", `Remerge` as "re-merge", and `OS` as "O.S." for speech. It also separates `filename` and `timezone` into "file name" and "time zone", including their plurals. It gives `written` the Kokoro hint `[written](/ɹˈɪtən/)` to make the second syllable explicit instead of the default `/ɹˈɪtn/`. Subtitles use the storyboard text, with "file name" and "time zone" spelled as separate words. Kokoro already reads `I/O`, `HBA`, `API`, `UTC`, and `SQL Server` ("sequel") correctly. Before adding a term, check what Kokoro does with it: the phonemes it yields are the ground truth, and transcribing the audio with Whisper hides errors because Whisper fills in acronyms from context.
- **Fitting:** each cue is spoken at normal speed with edge silence trimmed and must end 0.1 s before its cue end. A cue that runs over is spoken again faster, up to speed 1.1. If it still does not fit, the build fails and lists the cues; widen them (and their segment) in `storyboard.toml` rather than raising the speed.

To use a recorded voiceover instead, deliver one WAV or M4A exactly as long as the video with silence between cues, and run `make mux AUDIO=path/to/file`.

## Study order

1. `scenario.py` - sites, offsets, and incident ground truth.
2. `log_record.py` - the record type and offset-free timestamp formatting.
3. `os_log.py`, `db_log.py`, `app_log.py` - the three log generators, from simplest to the pool simulation.
4. `generate_logs.py` - writes the logs and `scenario.json`.
5. `storyboard.toml` and `storyboard.py` - timing, narration, and validation.
6. `cue.py` and `vtt.py` - the cue record and narration as WebVTT.
7. `log_blocks.py` - reading logs and merged output back, with the UTC-order check.
8. `merge_runner.py` - running the real CLI.
9. `scene_data.py` and `build_scene_data.py` - assembling what the scene shows.
10. `scene/index.html`, `scene/scene.css`, `scene/scene.js` - the deterministic scene.
11. `render.py` and `Makefile` - frame capture, encoding, and the pipeline.
12. `spoken_text.py`, `narrator.py`, `narrate.py` - text rewriting for speech, Kokoro synthesis and cue fitting, and the narration track.
13. `browser-storyboard.toml`, `append_narration.py` - browser timing and its placement after the original narration.
14. `browser_capture.py` - fixed-frame capture, pointer movements, typing, and scrolling.
15. `browser_walkthrough.py`, `render_browser.py` - the real UI sequence, download verification, and capture entry point; revisit `Makefile` for the final assembly.
