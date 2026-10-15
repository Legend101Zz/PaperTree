'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login');
  }, [router]);

  return (
    <div className="pt-s3-page flex items-center justify-center" role="status" aria-label="Loading PaperTree">
      <div className="pt-s3-skeleton" style={{ width: 160, minHeight: 8, height: 8 }} />
    </div>
  );
}
