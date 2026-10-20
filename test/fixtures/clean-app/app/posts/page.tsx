import { listPosts } from '../../lib/server/posts';

export const dynamic = 'force-dynamic';

export default async function PostsPage() {
  const posts = listPosts();
  return (
    <main>
      <h1>Notes</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <h2>{post.title}</h2>
            <p>{post.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
