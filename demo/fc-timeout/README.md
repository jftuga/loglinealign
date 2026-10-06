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

## Requirements

- [uv](https://docs.astral.sh/uv/) with Python 3.14 (Playwright 1.63.0 is pinned in `uv.lock`)
- Node.js 24 or newer, and the built CLI at `../../dist/loglinealign.js` (`make` builds it with `make -C ../.. cli` if it is missing)
- ffmpeg with libx264

## Usage

```sh
make setup     # once: create the virtual environment and install Chromium for Playwright
make           # build everything that is out of date and write build/explainer.mp4
```

| Target | Result |
| --- | --- |
| `make logs` | Regenerate `sample-logs/*.log` and `sample-logs/scenario.json` |
| `make scene` | Run both merges, write `build/merged-naive.log`, `build/merged-aligned.log`, `build/scene-data.js`, `build/narration.vtt` |
| `make stills` | PNG frames with burned-in narration at `TIMES` (for example `make stills TIMES="40 55"`) into `build/stills/` |
| `make video` | Silent `build/explainer.mp4`, 1920x1080, 30 fps |
| `make preview` | `build/explainer-captioned.mp4` with narration burned in, for reviewing timing without audio |
| `make mux AUDIO=narration.wav` | `build/explainer-narrated.mp4` with audio and a soft subtitle track |
| `make clean` | Delete `build/` |

To inspect the scene interactively, open `scene/index.html?t=58&captions=1` in a browser after `make scene`.

## Iterating

- **Narration or timing:** edit `storyboard.toml`. Segments play back to back; cue and beat times are relative to their segment. Beats drive the animation, so move a cue and its matching beat together. `make scene` rejects overlapping cues and cues faster than `max_words_per_second`.
- **Story or log content:** edit `scenario.py` (incident times, durations) or a generator, then `make`. Narration placeholders `{app_alert_hhmm}` and `{munich_hhmm}` are recomputed from the logs; other numbers in the narration are not.
- **Visuals:** edit `scene/scene.js` or `scene/scene.css`, check with `make stills`, then `make video`.

The pipeline is deterministic: the generator uses one seeded random generator, so the same code always writes byte-identical logs, and every frame is a pure function of `t` passed to `window.seek(t)`. Text uses system fonts (`system-ui`, Menlo), so renders are pixel-identical on the same machine but may differ slightly elsewhere.

## Narration handoff

`build/narration.vtt` is both the subtitle track and the voiceover script. For the audio pass:

1. Speak each cue starting at its start time and finish before its end time. Cues are kept at or below 2.6 words per second.
2. Deliver one WAV or M4A file exactly as long as the video (the duration is printed by `make scene`), with silence between cues.
3. Pronounce `I/O` as "I O", `HBA` as "H B A", and times such as `13:37` as "thirteen thirty-seven".
4. Run `make mux AUDIO=path/to/file`.

If a voice cannot fit a cue, widen the cue (and its segment duration) in `storyboard.toml` and re-render, rather than speeding up the speech.

## Study order

1. `scenario.py` - sites, offsets, and incident ground truth.
2. `log_record.py` - the record type and offset-free timestamp formatting.
3. `os_log.py`, `db_log.py`, `app_log.py` - the three log generators, from simplest to the pool simulation.
4. `generate_logs.py` - writes the logs and `scenario.json`.
5. `storyboard.toml` and `storyboard.py` - timing, narration, and validation.
6. `vtt.py` - narration as WebVTT.
7. `log_blocks.py` - reading logs and merged output back, with the UTC-order check.
8. `merge_runner.py` - running the real CLI.
9. `scene_data.py` and `build_scene_data.py` - assembling what the scene shows.
10. `scene/index.html`, `scene/scene.css`, `scene/scene.js` - the deterministic scene.
11. `render.py` and `Makefile` - frame capture, encoding, and the pipeline.
