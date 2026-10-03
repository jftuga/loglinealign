# Build both distributables with project-local tools. Run make install first.
NODE ?= node
.PHONY: all install cli web check clean
all: cli web
install:
	pnpm install --frozen-lockfile
cli:
	$(NODE) scripts/build.mjs cli
web:
	$(NODE) scripts/build.mjs web
check:
	$(NODE) node_modules/typescript/bin/tsc --noEmit
# Match the generated-project section of .gitignore; preserve local data and lockfiles.
clean:
	rm -rf -- ./dist ./node_modules ./.pnpm-store ./*.tsbuildinfo ./pnpm-debug.log* ./.pnpm-debug.log*
