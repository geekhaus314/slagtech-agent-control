import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const databasePath = process.env.DATABASE_PATH ?? './data/app.db';
const schemaPath = path.join(process.cwd(), 'lib/server/schema.sql');

export const db = new Database(databasePath);
db.exec(readFileSync(schemaPath, 'utf8'));
