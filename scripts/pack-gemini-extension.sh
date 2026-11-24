#!/bin/sh
# Packs the Gemini CLI extension: the gemini/ folder with dist/brb.mjs inside it, the manifest at the archive's root.
# Gemini CLI only installs an extension whose manifest is at the root, and this repo's root is the Claude Code plugin,
# so `gemini extensions install` takes this archive from the latest GitHub Release instead of cloning the repo.
# Run from the repo root. The first argument is where to write the archive.
set -eu
out="${1:-brb-gemini-extension.tar.gz}"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
cp -R gemini/. "$dir/"
mkdir "$dir/dist"
cp dist/brb.mjs "$dir/dist/"
cp LICENSE "$dir/"
tar -czf "$out" -C "$dir" .
