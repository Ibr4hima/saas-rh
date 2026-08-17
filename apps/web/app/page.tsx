'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';
import { useMe } from '../lib/hooks';

export default function HomePage() {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.data) router.replace('/dashboard');
    else if (me.isError) router.replace('/login');
  }, [me.data, me.isError, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Skeleton className="mb-4 h-8 w-48" />
      <Skeleton className="h-4 w-full" />
    </main>
  );
}
