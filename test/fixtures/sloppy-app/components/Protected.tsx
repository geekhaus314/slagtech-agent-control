'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function Protected() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) router.push('/login');
  }, [router]);

  return <section>Protected dashboard</section>;
}
