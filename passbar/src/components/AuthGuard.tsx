"use client";

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isSupabaseConfigured && !user) {
      const next = encodeURIComponent(pathname || '/dashboard');
      router.replace(`/auth?next=${next}`);
    }
  }, [loading, pathname, router, user]);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Alert className="max-w-xl">
          <AlertTitle>Supabase is not configured</AlertTitle>
          <AlertDescription className="mt-2 space-y-4">
            <p>Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` before using protected PassBar pages.</p>
            <Button asChild>
              <Link href="/auth">Open Sign In</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
