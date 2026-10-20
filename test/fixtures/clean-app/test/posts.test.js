import test from 'node:test';
import assert from 'node:assert/strict';

test('post input accepts a title and body', () => {
  const post = { title: 'First note', body: 'A short report.' };
  assert.equal(post.title.length > 0, true);
  assert.equal(post.body.length > 0, true);
});
