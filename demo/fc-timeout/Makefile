# Reproducible pipeline for the fibre channel timeout explainer:
#   scenario code -> sample-logs/ -> loglinealign merges + build/scene-data.js -> build/explainer.mp4
# File targets rebuild only what changed. Run `make setup` once, then `make` after each edit.
UV ?= uv
LOGLINEALIGN ?= ../../dist/loglinealign.js
TIMES ?= 3 15 33 46 55 59 82 89 101
AUDIO ?=

GENERATOR := generate_logs.py scenario.py log_record.py app_log.py db_log.py os_log.py
BUILDER := build_scene_data.py scene_data.py log_blocks.py merge_runner.py storyboard.py vtt.py storyboard.toml
SCENE := scene/index.html scene/scene.css scene/scene.js render.py

.PHONY: all setup logs scene stills video preview mux clean
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

build/explainer.mp4: build/scene-data.js $(SCENE)
	$(UV) run python render.py --out $@

logs: sample-logs/scenario.json
scene: build/scene-data.js
video: build/explainer.mp4

stills: build/scene-data.js
	$(UV) run python render.py --still $(TIMES) --captions

preview: build/scene-data.js
	$(UV) run python render.py --captions --out build/explainer-captioned.mp4

mux: build/explainer.mp4
	@test -n "$(AUDIO)" || { echo "usage: make mux AUDIO=path/to/narration.wav" >&2; exit 1; }
	ffmpeg -y -loglevel error -i build/explainer.mp4 -i "$(AUDIO)" -i build/narration.vtt \
		-map 0:v -map 1:a -map 2:s -c:v copy -c:a aac -b:a 192k -c:s mov_text -metadata:s:s:0 language=eng \
		build/explainer-narrated.mp4

clean:
	rm -rf -- build
