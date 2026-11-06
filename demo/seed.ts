// Seeds the demo world and prints shell lines for `eval`. Run through the tape; never run brb against your real home.
import { seedScenario } from '../test/support/scenario';

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const { home, repo } = seedScenario(process.argv[2] ?? '/tmp/brb-demo', Date.now());
// brb honors these before HOME, so a shell that exports them would show real sessions instead of the demo.
console.log('unset CLAUDE_CONFIG_DIR CODEX_HOME BRB_HOME');
console.log(`export HOME=${q(home)} BRB_NO_AI=1`);
console.log(`cd ${q(repo)}`);
