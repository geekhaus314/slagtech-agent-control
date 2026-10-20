'use client';

export function AuthButton({ password }: { password: string }) {
  if (password === 'admin') {
    localStorage.setItem('token', 'authenticated');
    return <p>Welcome back</p>;
  }
  return <p>Try again</p>;
}
