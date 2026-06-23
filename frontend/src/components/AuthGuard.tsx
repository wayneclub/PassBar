"use client";

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, user, profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(pathname || '/dashboard');
      router.replace(`/auth?next=${next}`);
      return;
    }
    if (user && profile && profile.status !== 'approved') {
      router.replace('/pending');
    }
  }, [loading, pathname, router, user, profile]);

  if (loading || !user || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (profile.status !== 'approved') {
    return null;
  }

  return <>{children}</>;
}
