// Publishes dist/ to the gh-pages branch. Code only: nothing here ever contains user data.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'inherit' });
const read = (cwd, ...args) => execFileSync('git', args, { cwd }).toString().trim();

if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing. Run the build first.');
const remote = read(root, 'remote', 'get-url', 'origin');
const rev = read(root, 'rev-parse', '--short', 'HEAD');

rmSync(join(dist, '.git'), { recursive: true, force: true });
writeFileSync(join(dist, '.nojekyll'), '');
run(dist, 'init', '-q', '-b', 'gh-pages');
run(dist, 'add', '-A');
run(dist, '-c', 'user.name=steadfast-deploy', '-c', 'user.email=deploy@localhost', 'commit', '-q', '-m', `Deploy ${rev}`);
run(dist, 'push', '-f', remote, 'gh-pages');
rmSync(join(dist, '.git'), { recursive: true, force: true });
console.log('Deployed', rev);
