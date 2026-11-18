// CBMC current-main T4 R104 SDK evidence driver.
// Loads the exact repo-tree sdk.mjs entry given as argv[3] and calls the
// portfolio gateway exactly once per invocation, printing the full structured
// result JSON to stdout. The process exit of this driver is the harness exit
// (recorded as harness_exit_code); it is NOT a native/SDK operation exit —
// runPortableGate returns typed results and never defines a process exit code.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [mode, entry] = process.argv.slice(2);
if (!['doctor', 'verify'].includes(mode) || !entry) {
  process.stderr.write('usage: node sdk-driver.mjs <doctor|verify> <path/to/sdk.mjs>\n');
  process.exit(2);
}
const { runPortableGate } = await import(pathToFileURL(resolve(entry)).href);
const result = await runPortableGate('cbmc', { mode: mode === 'doctor' ? 'doctor' : 'verify-fixture' });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
