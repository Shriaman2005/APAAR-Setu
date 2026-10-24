// npm run lint - a lightweight check that every server JavaScript file parses.
// (No ESLint dependency is added; this keeps the toolchain small for the prototype.)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['src', 'scripts', 'tests'].map((dir) => path.resolve(__dirname, '..', dir));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
roots.filter((dir) => fs.existsSync(dir)).forEach(walk);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`Syntax error in ${path.relative(process.cwd(), file)}:\n${error.stderr.toString()}`);
  }
}
console.log(`Checked ${files.length} files: ${failed === 0 ? 'all OK' : `${failed} failed`}.`);
process.exit(failed === 0 ? 0 : 1);
