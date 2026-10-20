'use client';

import { useState } from 'react';

export default function HomePage() {
  const [name, setName] = useState('');

  async function submit() {
    try {
      await fetch('/api/missing', { method: 'POST' });
    } catch {}
  }

  return (
    <main>
      <h1>Welcome to Next.js</h1>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <p>Trusted by 10,000+ users. Feature coming soon.</p>
      <img src="/missing.png" />
      <a href="#">Get started</a>
      <a href="/missing-page">Pricing</a>
      <a href="http://example.com" target="_blank">Docs</a>
      <button>Learn more</button>
      <button onClick={() => {}}>Do nothing</button>
      <div onClick={() => submit()}>Clickable card</div>
      <form>
        <input value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit">Subscribe</button>
      </form>
      <form action="/api/contact" method="post">
        <input name="email" />
        <button type="submit">Contact</button>
      </form>
      <div dangerouslySetInnerHTML={{ __html: name }} />
      <p>John Doe said this is the best product.</p>
      <p>TODO: build the dashboard.</p>
      <button disabled>Start free trial</button>
      <p>{eval(name)}</p>
      <button onClick={() => { console.log('clicked'); alert('todo'); }}>Run</button>
      <button onClick={() => { throw new Error('Not implemented'); }}>Save</button>
    </main>
  );
}
