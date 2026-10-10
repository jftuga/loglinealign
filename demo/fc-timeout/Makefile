# Reproducible pipeline for the fibre channel timeout explainer:
#   scenario code -> sample-logs/ -> scene-data.js -> explainer-base.mp4 + browser.mp4 -> explainer.mp4
#   base/browser VTT -> Kokoro TTS -> concatenated narration.wav -> explainer-narrated.mp4
#   explainer.mp4 + narration -> 2-pass HEVC -> explainer-narrated-hevc.mp4 (under 10 MB)
# File targets rebuild only what changed. Run `make setup` once, then `make` after each edit.
UV ?= uv
LOGLINEALIGN ?= ../../dist/loglinealign.js
WEB ?= ../../dist/loglinealign.html
TIMES ?= 3 15 33 46 55 59 82 89 101
AUDIO ?= build/narration.wav
# make small: the hard size limit, the target size the bitrate is computed from (headroom for
# container overhead and x265 rate-control drift), and the audio bitrate in kbit/s.
SMALL_MAX_BYTES ?= 10000000
SMALL_TARGET_BYTES ?= 9850000
SMALL_AUDIO_KBPS ?= 64

GENERATOR := generate_logs.py scenario.py log_record.py app_log.py db_log.py os_log.py
BUILDER := build_scene_data.py scene_data.py log_blocks.py merge_runner.py storyboard.py vtt.py cue.py storyboard.toml
SCENE := scene/index.html scene/scene.css scene/scene.js render.py
NARRATOR := narrate.py narrate.py.lock narrator.py spoken_text.py vtt.py cue.py
BROWSER := render_browser.py browser_capture.py browser_walkthrough.py browser-storyboard.toml

.PHONY: all setup logs scene stills video browser preview narration mux small clean
all: video

setup:
	$(UV) sync
	$(UV) run playwright install chromium

$(LOGLINEALIGN):
	$(MAKE) -C ../.. cli

$(WEB):
	$(MAKE) -C ../.. web

sample-logs/scenario.json: $(GENERATOR)
	$(UV) run python generate_logs.py --out-dir sample-logs

build/scene-data.js: sample-logs/scenario.json $(BUILDER) $(LOGLINEALIGN)
	$(UV) run python build_scene_data.py --loglinealign $(LOGLINEALIGN)

build/narration-base.vtt: build/scene-data.js
	@test -f $@ || $(UV) run python build_scene_data.py --loglinealign $(LOGLINEALIGN)

build/narration.vtt: build/narration-base.vtt browser-storyboard.toml append_narration.py storyboard.py vtt.py cue.py
	$(UV) run python append_narration.py

build/browser.vtt: build/narration.vtt
	@test -f $@ || $(UV) run python append_narration.py

build/explainer-base.mp4: build/scene-data.js $(SCENE)
	$(UV) run python render.py --out $@

build/browser.mp4: build/scene-data.js $(SCENE) $(BROWSER) $(WEB)
	$(UV) run python render_browser.py --web $(WEB)

build/explainer.mp4: build/explainer-base.mp4 build/browser.mp4
	@printf "file 'explainer-base.mp4'\nfile 'browser.mp4'\n" >| build/video-concat.txt
	ffmpeg -y -loglevel error -f concat -safe 0 -i build/video-concat.txt -c copy -movflags +faststart $@

# Kokoro needs Python 3.12, so narrate.py runs as a standalone uv script with its own lockfile.
build/narration-base.wav: build/narration-base.vtt build/explainer-base.mp4 $(NARRATOR)
	$(UV) run --script narrate.py --vtt build/narration-base.vtt --video build/explainer-base.mp4 --out $@

build/browser.wav: build/browser.vtt build/browser.mp4 $(NARRATOR)
	$(UV) run --script narrate.py --vtt build/browser.vtt --video build/browser.mp4 --out $@

build/narration.wav: build/narration-base.wav build/browser.wav
	ffmpeg -y -loglevel error -i build/narration-base.wav -i build/browser.wav -filter_complex '[0:a][1:a]concat=n=2:v=0:a=1[a]' -map '[a]' -c:a pcm_s16le $@

logs: sample-logs/scenario.json
scene: build/scene-data.js build/narration.vtt
video: build/explainer.mp4
browser: build/browser.mp4
narration: build/narration.wav

stills: build/scene-data.js
	$(UV) run python render.py --still $(TIMES) --captions

preview: build/explainer.mp4 build/narration.vtt
	ffmpeg -y -loglevel error -i build/explainer.mp4 -vf subtitles=build/narration.vtt -c:v libx264 -crf 18 build/explainer-captioned.mp4

mux: build/explainer.mp4 $(AUDIO) build/narration.vtt
# Keep edit-list durations within 32 bits for Apple's MP4 audio reader.
	ffmpeg -y -loglevel error -i build/explainer.mp4 -i "$(AUDIO)" -i build/narration.vtt \
		-map 0:v -map 1:a -map 2:s -c:v copy -c:a aac -b:a 192k -ar 48000 -c:s mov_text -metadata:s:s:0 language=eng \
		-movie_timescale 1000 -movflags +faststart build/explainer-narrated.mp4

small: build/explainer-narrated-hevc.mp4

# Two-pass HEVC sized for SMALL_MAX_BYTES: the video bitrate is whatever SMALL_TARGET_BYTES leaves
# after the audio over the video's duration. The output is deleted if it still exceeds the limit.
build/explainer-narrated-hevc.mp4: build/explainer.mp4 $(AUDIO) build/narration.vtt
	@seconds=$$(ffprobe -v error -show_entries format=duration -of csv=p=0 build/explainer.mp4) && \
	kbps=$$(awk -v b=$(SMALL_TARGET_BYTES) -v s=$$seconds -v a=$(SMALL_AUDIO_KBPS) 'BEGIN { printf "%d", b * 8 / s / 1000 - a }') && \
	echo "HEVC video bitrate: $${kbps}k for $${seconds} s" && \
	ffmpeg -y -loglevel error -i build/explainer.mp4 -map 0:v -c:v libx265 -preset slow -b:v $${kbps}k \
		-x265-params pass=1:stats=build/x265-2pass.log:log-level=error -an -f null /dev/null && \
	ffmpeg -y -loglevel error -i build/explainer.mp4 -i "$(AUDIO)" -i build/narration.vtt \
		-map 0:v -map 1:a -map 2:s -c:v libx265 -preset slow -b:v $${kbps}k -x265-params pass=2:stats=build/x265-2pass.log:log-level=error -tag:v hvc1 \
		-c:a aac -b:a $(SMALL_AUDIO_KBPS)k -ac 1 -ar 48000 -c:s mov_text -metadata:s:s:0 language=eng \
		-movie_timescale 1000 -movflags +faststart $@ && \
	bytes=$$(wc -c < $@) && echo "$@: $$bytes bytes" && \
	if [ $$bytes -ge $(SMALL_MAX_BYTES) ]; then echo "$@ is not under $(SMALL_MAX_BYTES) bytes; lower SMALL_TARGET_BYTES" >&2; rm -f $@; exit 1; fi

clean:
	rm -rf -- build
