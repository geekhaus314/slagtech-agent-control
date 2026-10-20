import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Field Notes</h1>
      <p>Short reports on how small teams ship and maintain software.</p>
      <Link href="/posts">Read the notes</Link>
    </main>
  );
}
