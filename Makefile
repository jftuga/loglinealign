# Build both distributables with project-local tools. Run make setup first.
NODE ?= node
.PHONY: all setup cli web check test clean
all: cli web
setup:
	pnpm install --frozen-lockfile
cli:
	$(NODE) scripts/build.mjs cli
web:
	$(NODE) scripts/build.mjs web
check:
	$(NODE) node_modules/typescript/bin/tsc --noEmit
test: cli
	$(NODE) --test tests/*.test.mjs
# Match the generated-project section of .gitignore; preserve local data and lockfiles.
clean:
	rm -rf -- ./dist ./node_modules ./.pnpm-store ./*.tsbuildinfo ./pnpm-debug.log* ./.pnpm-debug.log*
