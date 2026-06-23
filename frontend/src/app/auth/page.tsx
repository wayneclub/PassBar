"use client";

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/AuthProvider';
import { BrandLogo } from '@/components/BrandLogo';
import { authServiceUrl } from '@/lib/api';

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

  const handleGoogleSignIn = () => {
    setSubmitting(true);
    // `next` is consumed by auth-service after it redirects back from Google, while the
    // browser is on auth.wayneclub.com — a relative path would resolve against that origin,
    // not PassBar's, so it has to be an absolute URL pointing back at this site.
    const absoluteNext = new URL(nextPath, window.location.origin).toString();
    window.location.href = authServiceUrl(
      `/auth/google?product=passbar&next=${encodeURIComponent(absoluteNext)}`,
    );
  };

  const cookieNotice = (
    <p className="text-xs leading-5 text-slate-400">
      By continuing, you agree to our use of cookies to keep you signed in, remember your preferences, and analyse usage.{' '}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-300">Privacy Policy</Link>.
    </p>
  );

  return (
    <main className="flex min-h-dvh flex-col lg:min-h-screen">
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 lg:grid-cols-[0.9fr_1.1fr]">

        {/* Hero section */}
        <section className="flex flex-col bg-secondary p-8 text-white lg:justify-between lg:p-12">
          <div>
            <div className="mb-8 flex items-center gap-3 lg:mb-12">
              <BrandLogo className="h-12 w-12 rounded-2xl bg-white p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.28)]" />
              <div className="leading-none">
                <div className="text-2xl font-extrabold tracking-tight">
                  <span className="text-white">Pass</span><span className="text-primary">Bar</span>
                  <span className="ml-1 text-primary">✦</span>
                </div>
              </div>
            </div>
            <h1 className="max-w-md text-3xl font-semibold leading-tight lg:text-5xl">
              Practice smarter for the bar exam.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-300 lg:mt-5 lg:text-base lg:leading-7">
              Build custom MBE-style question sets, review every answer with an AI tutor, and focus your study time on the rules that matter most.
            </p>
          </div>
          {/* Cookie notice — desktop only, inside hero */}
          <div className="mt-12 hidden border-t border-primary/25 pt-5 lg:block">
            {cookieNotice}
          </div>
        </section>

        {/* Login section */}
        <section className="flex items-start justify-center p-6 pt-8 lg:items-center lg:p-12">
          <Card className="w-full max-w-md border-slate-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Continue with Google</CardTitle>
              <CardDescription>
                One click signs you in or creates your PassBar account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Button
                className="h-11 w-full gap-3 border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={submitting}
              >
                <GoogleIcon />
                {submitting ? 'Redirecting...' : 'Continue with Google'}
              </Button>
            </CardContent>
          </Card>
        </section>

      </div>

      {/* Cookie notice — mobile footer */}
      <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-center lg:hidden">
        {cookieNotice}
      </footer>
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
