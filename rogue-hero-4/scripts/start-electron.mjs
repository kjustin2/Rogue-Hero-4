import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('\nElectron is not installed in this project.');
  console.error('Run this first:\n');
  console.error('  npm install\n');
  console.error('Then start the standalone app with:\n');
  console.error('  npm start\n');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const electronArgs = extraArgs.length ? [...extraArgs, '.'] : ['.'];

const child = spawn(electronPath, electronArgs, {
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', code => process.exit(code ?? 0));
child.on('error', err => {
  console.error('Failed to launch Electron:', err.message);
  process.exit(1);
});
