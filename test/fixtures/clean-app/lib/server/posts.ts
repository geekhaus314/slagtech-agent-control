import { db } from './db';

export type Post = {
  id: number;
  title: string;
  body: string;
};

export function listPosts(): Post[] {
  return db.prepare('SELECT id, title, body FROM posts ORDER BY id DESC').all() as Post[];
}

export function createPost(input: { title: string; body: string }): Post {
  const result = db.prepare('INSERT INTO posts (title, body) VALUES (?, ?)').run(input.title, input.body);
  return {
    id: Number(result.lastInsertRowid),
    title: input.title,
    body: input.body,
  };
}
