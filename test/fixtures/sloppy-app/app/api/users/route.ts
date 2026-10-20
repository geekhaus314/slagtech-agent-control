import { NextResponse } from 'next/server';
import { addUser } from '../../lib/server/store';

export async function GET() {
  return NextResponse.json([
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Doe', email: 'jane@example.com' },
  ]);
}

export async function POST(request: Request) {
  const body = await request.json();
  addUser(body.name);
  return NextResponse.json({ ok: true, user: body });
}
