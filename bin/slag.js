#!/usr/bin/env node
import { main } from '../src/cli.js';

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
process.stderr.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

main(process.argv.slice(2)).catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  process.stderr.write(`slag: ${message}\n`);
  process.exit(2);
});
