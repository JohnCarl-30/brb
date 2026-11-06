---
name: brb
description: Catch up on every AI coding session, here and in your other projects
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/dist/brb.mjs" --no-ai --no-color --exclude "${CLAUDE_SESSION_ID}"`

Show the user the catch-up above exactly as printed, then ask which item they want to pick up first.
