'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LogoContext } from '../components/brand-mark';
import { ThemeProvider } from '../components/preferences';
import { useGardeDeSession } from '../lib/session';

export function Providers({
  children,
  logo,
}: {
  children: React.ReactNode;
  /** Le logo installé, trouvé au serveur ; null sans fichier. */
  logo: string | null;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      }),
  );
  useGardeDeSession(client);
  return (
    <QueryClientProvider client={client}>
      <LogoContext.Provider value={logo}>
        <ThemeProvider>{children}</ThemeProvider>
      </LogoContext.Provider>
    </QueryClientProvider>
  );
}
