"use client";

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/AuthProvider';
import { BrandLogo } from '@/components/BrandLogo';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { absoluteAppUrl } from '@/lib/site';

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, user } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const nextPath = useMemo(() => {
    const next = searchParams.get('next');
    return next?.startsWith('/') ? next : '/dashboard';
  }, [searchParams]);

  useEffect(() => {
    if (!loading && user) {
      router.replace(nextPath);
    }
  }, [loading, nextPath, router, user]);

  const handleGoogleSignIn = async () => {
    setError('');

    if (!supabase) {
      setError('Supabase environment variables are missing.');
      return;
    }

    setSubmitting(true);
    const redirectTo = absoluteAppUrl(`/auth?next=${encodeURIComponent(nextPath)}`);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-between bg-secondary p-8 text-white lg:p-12">
          <div>
            <div className="mb-10 flex items-center gap-3">
              <BrandLogo className="h-12 w-12 rounded-xl bg-white p-2 shadow-sm" />
              <BrandLogo variant="wordmark" className="h-12 w-32 rounded-md bg-white/95 px-2" />
            </div>
            <h1 className="max-w-md text-4xl font-semibold leading-tight">Sign in with Google to sync your bar prep progress.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
              Your sessions, answers, marked questions, and performance history will attach to your Google account.
            </p>
          </div>
          <div className="mt-12 border-t border-white/10 pt-6 text-xs text-slate-400">
            One Google account for sign in and registration.
          </div>
        </section>

        <section className="flex items-center justify-center p-6 lg:p-12">
          <Card className="w-full max-w-md border-slate-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Continue to PassBar</CardTitle>
              <CardDescription>
                New users are registered automatically after Google authorization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!isSupabaseConfigured && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Missing Supabase config</AlertTitle>
                  <AlertDescription>
                    Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` before using Google sign in.
                  </AlertDescription>
                </Alert>
              )}

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}

              <Button
                className="h-11 w-full gap-3 border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={submitting || !isSupabaseConfigured}
              >
                <GoogleIcon />
                {submitting ? 'Redirecting...' : 'Continue with Google'}
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50" />}>
      <AuthContent />
    </Suspense>
  );
}
