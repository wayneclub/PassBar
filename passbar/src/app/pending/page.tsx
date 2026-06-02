"use client";

import React from 'react';
import { Clock, XCircle, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { BrandLogo } from '@/components/BrandLogo';

export default function PendingPage() {
  const { profile, signOut } = useAuth();
  const isRejected = profile?.status === 'rejected';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top nav */}
      <header className="flex items-center justify-between border-b bg-card px-6 py-4">
        <BrandLogo variant="wordmark" className="h-8 w-36" />
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          登出
        </button>
      </header>

      {/* Main */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">

          {/* Status icon */}
          <div className="flex justify-center">
            {isRejected ? (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Clock className="h-8 w-8 text-primary animate-pulse" />
              </div>
            )}
          </div>

          {/* Title & description */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-foreground">
              {isRejected ? '存取遭拒' : '審核中'}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isRejected
                ? '你的帳號申請已被拒絕。如有疑問，請透過下方 Email 聯絡管理員。'
                : '帳號正在審核中，管理員核准後你將可以使用 PassBar 全功能題庫。'}
            </p>
          </div>

          {/* Info card */}
          <div className="rounded-xl border bg-card divide-y">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">登入帳號</p>
                <p className="truncate text-sm font-medium text-foreground">{profile?.email ?? '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">帳號狀態</p>
                <p className="text-sm font-medium text-foreground">
                  {isRejected ? '已拒絕' : '待審核'}
                </p>
              </div>
            </div>
          </div>

          {/* Tips */}
          {!isRejected && (
            <p className="text-center text-xs text-muted-foreground">
              審核通常在 24 小時內完成。請稍候，無需重複提交申請。
            </p>
          )}

          {/* Sign out */}
          <button
            onClick={signOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-card py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            登出並切換帳號
          </button>
        </div>
      </div>
    </div>
  );
}
