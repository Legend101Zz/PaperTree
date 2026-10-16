/**
 * The app's react-query provider for specs that mount the explain panel (it reads the stored
 * threads through react-query since #202). Production mounts one in `app/providers.tsx`; a spec
 * gets a fresh client per render, with no retries, so a 404 from the fetch stub settles at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function TestQueryProvider({ children }: { readonly children?: ReactNode }): ReactNode {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
