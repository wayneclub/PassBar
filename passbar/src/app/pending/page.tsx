"use client";

import React, { useEffect } from 'react';
import { Clock, XCircle, Mail, ShieldAlert, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/components/AuthProvider';

export default function PendingPage() {
  const { loading, user, profile, signOut } = useAuth();
  const router = useRouter();
  const isRejected = profile?.status === 'rejected';

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth');
    }
  }, [loading, user, router]);

  // Redirect to dashboard if somehow approved
  useEffect(() => {
    if (!loading && user && profile?.status === 'approved') {
      router.replace('/dashboard');
    }
  }, [loading, user, profile, router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth');
  };

  if (loading || !user || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[0.9fr_1.1fr]">

        {/* Left dark panel — same as auth page */}
        <section className="flex flex-col justify-between bg-secondary p-8 text-white lg:p-12">
          <div>
            <div className="mb-12 flex items-center gap-4">
              <BrandLogo className="h-14 w-14 rounded-2xl bg-white p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.28)]" />
              <div className="leading-none">
                <div className="text-3xl font-extrabold tracking-tight">
                  <span className="text-white">Pass</span><span className="text-primary">Bar</span>
                  <span className="ml-1 text-primary">✦</span>
                </div>
                <div className="mt-2 text-xs font-bold uppercase tracking-[0.22em] text-primary/80">MBE QBank</div>
              </div>
            </div>
            <h1 className="max-w-md text-4xl font-semibold leading-tight lg:text-5xl">
              {isRejected ? 'Access not approved.' : 'Almost there.'}
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300">
              {isRejected
                ? 'Your account request was not approved. If you believe this is a mistake, please contact the administrator.'
                : "Your account is pending review. Once approved, you'll have full access to PassBar's MBE question bank and AI tutor."}
            </p>
          </div>
          <div className="mt-12 border-t border-primary/25 pt-6 text-sm leading-6 text-slate-400">
            {isRejected
              ? 'You can sign out and try a different account below.'
              : 'Approval is usually completed within 24 hours. No action required on your end.'}
          </div>
        </section>

        {/* Right white panel */}
        <section className="flex items-center justify-center p-6 lg:p-12">
          <Card className="w-full max-w-md border-slate-200 shadow-lg">
            <CardHeader>
              <div className={`mb-2 flex h-12 w-12 items-center justify-center rounded-2xl ${isRejected ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                {isRejected
                  ? <XCircle className="h-6 w-6 text-destructive" />
                  : <Clock className="h-6 w-6 text-primary animate-pulse" />}
              </div>
              <CardTitle className="text-2xl">
                {isRejected ? '存取遭拒' : '審核中'}
              </CardTitle>
              <CardDescription>
                {isRejected
                  ? '你的帳號申請已被拒絕。'
                  : '帳號正在等待管理員審核。'}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Info rows */}
              <div className="divide-y rounded-xl border bg-slate-50">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">登入帳號</p>
                    <p className="truncate text-sm font-medium">{profile?.email ?? '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">帳號狀態</p>
                    <p className={`text-sm font-semibold ${isRejected ? 'text-destructive' : 'text-primary'}`}>
                      {isRejected ? '已拒絕' : '待審核'}
                    </p>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                className="h-11 w-full gap-2 border-slate-300"
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4" />
                登出並切換帳號
              </Button>
            </CardContent>
          </Card>
        </section>

      </div>
    </main>
  );
}
