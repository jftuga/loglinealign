# Reproducible pipeline for the fibre channel timeout explainer:
#   scenario code -> sample-logs/ -> loglinealign merges + build/scene-data.js -> build/explainer.mp4
#   build/narration.vtt -> Kokoro TTS -> build/narration.wav -> build/explainer-narrated.mp4
# File targets rebuild only what changed. Run `make setup` once, then `make` after each edit.
UV ?= uv
LOGLINEALIGN ?= ../../dist/loglinealign.js
TIMES ?= 3 15 33 46 55 59 82 89 101
AUDIO ?= build/narration.wav

GENERATOR := generate_logs.py scenario.py log_record.py app_log.py db_log.py os_log.py
BUILDER := build_scene_data.py scene_data.py log_blocks.py merge_runner.py storyboard.py vtt.py cue.py storyboard.toml
SCENE := scene/index.html scene/scene.css scene/scene.js render.py
NARRATOR := narrate.py narrate.py.lock narrator.py spoken_text.py vtt.py cue.py

.PHONY: all setup logs scene stills video preview narration mux clean
all: video

setup:
	$(UV) sync
	$(UV) run playwright install chromium

$(LOGLINEALIGN):
	$(MAKE) -C ../.. cli

sample-logs/scenario.json: $(GENERATOR)
	$(UV) run python generate_logs.py --out-dir sample-logs

build/scene-data.js: sample-logs/scenario.json $(BUILDER) $(LOGLINEALIGN)
	$(UV) run python build_scene_data.py --loglinealign $(LOGLINEALIGN)

build/narration.vtt: build/scene-data.js ;

build/explainer.mp4: build/scene-data.js $(SCENE)
	$(UV) run python render.py --out $@

# Kokoro needs Python 3.12, so narrate.py runs as a standalone uv script with its own lockfile.
build/narration.wav: build/narration.vtt build/explainer.mp4 $(NARRATOR)
	$(UV) run --script narrate.py --vtt build/narration.vtt --video build/explainer.mp4 --out $@

logs: sample-logs/scenario.json
scene: build/scene-data.js
video: build/explainer.mp4
narration: build/narration.wav

stills: build/scene-data.js
	$(UV) run python render.py --still $(TIMES) --captions

preview: build/scene-data.js
	$(UV) run python render.py --captions --out build/explainer-captioned.mp4

mux: build/explainer.mp4 $(AUDIO)
	ffmpeg -y -loglevel error -i build/explainer.mp4 -i "$(AUDIO)" -i build/narration.vtt \
		-map 0:v -map 1:a -map 2:s -c:v copy -c:a aac -b:a 192k -ar 48000 -c:s mov_text -metadata:s:s:0 language=eng \
		build/explainer-narrated.mp4

clean:
	rm -rf -- build
