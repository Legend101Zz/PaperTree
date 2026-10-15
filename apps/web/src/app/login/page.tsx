'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthShell } from '@/components/auth/AuthShell';
import { authFailure } from '@/components/auth/messages';
import { safeNext } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      // Read at submit time (not render time) so no Suspense boundary is needed, and sanitised:
      // same-origin relative paths only.
      router.push(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err) {
      setError(authFailure(err, 'Sign in failed. Check your email and password and try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Pick up reading where you left off.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="pt-s3-alert pt-s3-alert--error">
            {error}
          </p>
        )}

        <Input
          type="email"
          label="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <Button type="submit" className="pt-s3-btn--block" isLoading={isLoading}>
          Sign in
        </Button>
      </form>

      <p className="pt-s3-muted mt-6 text-center text-sm">
        New to PaperTree?{' '}
        <Link href="/register" className="pt-s3-link">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
