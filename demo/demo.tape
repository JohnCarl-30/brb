Output docs/demo.gif
Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 600
Set Padding 24
Set Theme "GitHub Dark"
Hide
# demo/bin stands in for the AI CLIs, so picking a session doesn't start a real one.
Type `alias brb="node $PWD/dist/brb.mjs" && export PATH="$PWD/demo/bin:$PATH" && eval "$(npx tsx demo/seed.ts /tmp/brb-demo)" && clear`
Enter
Sleep 4s
Show
Type "brb"
Sleep 600ms
Enter
Sleep 4s
Type "1"
Sleep 800ms
Enter
Sleep 3s
