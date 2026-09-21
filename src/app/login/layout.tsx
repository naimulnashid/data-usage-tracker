import type { Metadata } from 'next';

/**
 * Exists only to give /login a title. The page itself is a client component,
 * and client components cannot export metadata.
 */
export const metadata: Metadata = { title: 'Sign in' };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
