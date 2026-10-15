/**
 * S3 — the auth wiring (N20): what the user sees when the server says no, what a flaky network does
 * (nothing: it never signs anyone out), where sign-in sends them (same-origin paths only), and
 * that Sign out really tells the server.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { NetworkError } from '@/lib/api/client';
import { authApi } from '@/lib/api/papers';
import { ApiError } from '@/lib/api/types';
import { getToken, safeNext, setToken } from '@/lib/auth';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';
import { useAuthStore } from '@/store/authStore';

const push = vi.fn();
const replace = vi.fn();
let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
}));

const SESSION = { token: 'tok_1', user_id: 'usr_1', email: 'a@b.test' };

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/login');
  push.mockReset();
  replace.mockReset();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fillLogin(email = 'a@b.test', password = 'correct-horse') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the server detail is shown', () => {
  it('login: a 401 shows the server sentence', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError(401, 'invalid_credentials', 'invalid email or password', false),
    );
    render(<LoginPage />);
    fillLogin();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Invalid email or password. Check them and try again.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('login: a 422 detail is shown, and raw JSON never is', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError(422, 'validation_failed', 'email: value is not a valid email address', false),
    );
    render(<LoginPage />);
    fillLogin();
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a valid email/);

    cleanup();
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError(400, 'validation_failed', '{"detail":"x"}', false),
    );
    render(<LoginPage />);
    fillLogin();
    expect((await screen.findByRole('alert')).textContent).not.toMatch(/\{/);
  });

  it('register: a 409 shows the server sentence', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(
      new ApiError(409, 'email_taken', 'that email is already registered', false),
    );
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'long-enough-1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'long-enough-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That email is already registered.',
    );
  });

  it('login: a network error is a sentence about the connection', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new NetworkError('x'));
    render(<LoginPage />);
    fillLogin();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be reached/i);
  });

  it('register: the client-side minimum is 8 (7 is refused without calling the API)', async () => {
    const register = vi.spyOn(authApi, 'register');
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: '1234567' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/);
    expect(register).not.toHaveBeenCalled();
  });

  it('every form field has an associated label', () => {
    render(<RegisterPage />);
    for (const input of document.querySelectorAll('input')) {
      expect(input.labels?.length, `input ${input.type} has no label`).toBeGreaterThan(0);
    }
  });
});

describe('?next=', () => {
  async function loginAt(search: string) {
    window.history.replaceState({}, '', `/login${search}`);
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    render(<LoginPage />);
    fillLogin();
    await waitFor(() => expect(push).toHaveBeenCalled());
    return push.mock.calls[0]?.[0];
  }

  it('honours a same-origin relative path', async () => {
    expect(await loginAt('?next=%2Fpaper%2Fppr_X%2Fread')).toBe('/paper/ppr_X/read');
  });

  it('defaults to /dashboard with no next', async () => {
    expect(await loginAt('')).toBe('/dashboard');
  });

  it.each([
    ['//evil.example/x'],
    ['/..//evil.example'],
    ['/a/..//evil.example'],
    ['/.//evil.example'],
    ['https://evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['/%2F%2Fevil.example'],
    ['/%5Cevil.example'],
    ['/login'],
    ['evil.example'],
  ])('refuses %s', async (next) => {
    expect(await loginAt(`?next=${encodeURIComponent(next)}`)).toBe('/dashboard');
  });

  it('safeNext keeps query strings and refuses control characters', () => {
    expect(safeNext('/paper/x/read?gen=2')).toBe('/paper/x/read?gen=2');
    expect(safeNext('/a\nb')).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
  });
});

describe('checkAuth: only a 401 signs out', () => {
  beforeEach(() => setToken('tok_1'));

  it('a network error keeps the session', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new NetworkError('offline'));
    await useAuthStore.getState().checkAuth();
    expect(getToken()).toBe('tok_1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().sessionUnverified).toBe(true);
  });

  it('a 500 keeps the session', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(500, 'internal', 'boom', false));
    await useAuthStore.getState().checkAuth();
    expect(getToken()).toBe('tok_1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('a 401 signs out and clears the token', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'auth_required', 'no', false));
    await useAuthStore.getState().checkAuth();
    expect(getToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('sign out', () => {
  it('calls POST /auth/logout, then clears the local session', async () => {
    setToken('tok_1');
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u', email: 'a@b.test' },
    });
    let tokenAtCall: string | null = null;
    const logout = vi.spyOn(authApi, 'logout').mockImplementation(async () => {
      tokenAtCall = getToken();
    });
    await useAuthStore.getState().logout();
    expect(logout).toHaveBeenCalledTimes(1);
    // The server call happens while the token can still authenticate it.
    expect(tokenAtCall).toBe('tok_1');
    expect(getToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('still clears the session when the call fails (offline)', async () => {
    setToken('tok_1');
    useAuthStore.setState({ isAuthenticated: true, isLoading: false });
    vi.spyOn(authApi, 'logout').mockRejectedValue(new NetworkError('offline'));
    await useAuthStore.getState().logout();
    expect(getToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('AuthGuard', () => {
  it('sends a visitor with no session to /login?next=<current path>', async () => {
    pathname = '/paper/ppr_X/read';
    render(
      <AuthGuard>
        <p>secret</p>
      </AuthGuard>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fpaper%2Fppr_X%2Fread'),
    );
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('renders the page for a signed-in user, even when /auth/me cannot be reached', async () => {
    setToken('tok_1');
    vi.spyOn(authApi, 'me').mockRejectedValue(new NetworkError('offline'));
    render(
      <AuthGuard>
        <p>secret</p>
      </AuthGuard>,
    );
    expect(await screen.findByText('secret')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
