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

/** Matches the server (contracts.md §2.1): 8 to 1024 characters. */
const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match. Type the same password in both fields.');
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password);
      router.push(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err) {
      setError(authFailure(err, 'Could not create the account. Check the details and try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Read papers with the paper itself in front of you.">
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
          autoComplete="new-password"
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <Input
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />

        <Button type="submit" className="pt-s3-btn--block" isLoading={isLoading}>
          Create account
        </Button>
      </form>

      <p className="pt-s3-muted mt-6 text-center text-sm">
        Already have an account?{' '}
        <Link href="/login" className="pt-s3-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
