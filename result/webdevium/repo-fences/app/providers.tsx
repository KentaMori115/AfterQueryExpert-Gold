'use client'

import { UserProvider } from '@/contexts/user-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return <UserProvider>{children}</UserProvider>
}

