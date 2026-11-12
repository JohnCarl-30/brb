Output docs/demo.gif
Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 640
Set Padding 24
Set Theme "GitHub Dark"
Set WindowBar Colorful
Set TypingSpeed 90ms
Hide
# demo/bin stands in for the AI CLIs, so picking a session doesn't start a real one.
Type `alias brb="node $PWD/dist/brb.mjs" && export PATH="$PWD/demo/bin:$PATH" && eval "$(npx tsx demo/seed.ts "${TMPDIR:-/tmp}/brb-demo")" && clear`
Enter
Sleep 4s
Show
# 1. A glance: the totals as one line, the same one a prompt or status line can show.
Sleep 800ms
Type "brb --count"
Sleep 600ms
Enter
Sleep 2500ms
# 2. Everything that moved, in one screen.
Type "brb"
Sleep 600ms
Enter
Sleep 6s
# 3. Pick the session that is waiting on you and land in it. The stand-in outlasts the recording.
Type "1"
Sleep 900ms
Enter
Sleep 4s
