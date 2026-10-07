/**
 * Convenience launcher: starts the Vite dev server and the Socket.IO relay
 * side by side (npm run dev:all). Zero extra dependencies — just child_process.
 */

import { spawn } from 'node:child_process';

const procs = [];

function run(name, cmd, args, color) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream) => stream.on('data', (buf) => {
    String(buf).split('\n').filter(Boolean).forEach((line) => console.log(tag + line));
  });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}exited with code ${code}`);
    shutdown();
  });
  procs.push(child);
  return child;
}

function shutdown() {
  procs.forEach((p) => { try { p.kill('SIGTERM'); } catch { /* noop */ } });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\n  🏁  SUPER RACERS — dev stack\n');
run('relay', process.execPath, ['server/server.js'], '36');
run('vite', process.execPath, ['node_modules/vite/bin/vite.js'], '35');
