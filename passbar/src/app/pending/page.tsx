"use client";

import React from 'react';
import { Clock, XCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { BrandLogo } from '@/components/BrandLogo';

export default function PendingPage() {
  const { profile, signOut } = useAuth();

  const isRejected = profile?.status === 'rejected';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="mb-8">
        <BrandLogo />
      </div>

      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm text-center space-y-4">
        {isRejected ? (
          <>
            <div className="flex justify-center">
              <XCircle className="h-12 w-12 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold">存取遭拒</h1>
            <p className="text-sm text-muted-foreground">
              你的帳號申請已被拒絕。如有疑問，請聯絡管理員。
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <Clock className="h-12 w-12 text-primary animate-pulse" />
            </div>
            <h1 className="text-xl font-semibold">等待審核中</h1>
            <p className="text-sm text-muted-foreground">
              你的帳號正在等待管理員核准，核准後即可使用 PassBar。
            </p>
            <p className="text-xs text-muted-foreground">
              登入帳號：{profile?.email}
            </p>
          </>
        )}

        <Button
          variant="outline"
          className="mt-4 w-full gap-2"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          登出
        </Button>
      </div>
    </div>
  );
}
