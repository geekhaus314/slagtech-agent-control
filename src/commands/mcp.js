import { createMcpServer } from '../mcp/server.js';

export async function runMcp({ flags }) {
  const root = flags.root ? String(flags.root) : flags.cwd ? String(flags.cwd) : process.cwd();
  createMcpServer({ root });
  return new Promise(() => {});
}
