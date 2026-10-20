import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPost, listPosts } from '../../../lib/server/posts';

const PostInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

export async function GET() {
  try {
    return NextResponse.json({ posts: listPosts() });
  } catch (error) {
    return NextResponse.json({ error: 'Unable to read posts.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = PostInput.parse(await request.json());
    return NextResponse.json({ post: createPost(input) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid post.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to create post.' }, { status: 500 });
  }
}
