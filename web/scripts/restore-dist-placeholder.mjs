// Vite empties `dist` on every build, which would delete the placeholder that
// `//go:embed all:dist` needs. Run automatically as the `postbuild` script.
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/.gitkeep', import.meta.url), '');
console.log('web/scripts: restored dist/.gitkeep');
