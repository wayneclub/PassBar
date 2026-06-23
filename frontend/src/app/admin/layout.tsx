"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { MobileAppHeader } from '@/components/MobileAppHeader';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/auth'); return; }
    if (profile && profile.role !== 'admin') router.replace('/dashboard');
  }, [loading, user, profile, router]);

  if (loading || !user || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (profile.role !== 'admin') return null;

  return (
    <SidebarProvider className="h-screen min-h-0 overflow-hidden">
      <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background">
        <AppSidebar />
        <SidebarInset className="h-screen min-h-0 flex-1 overflow-y-auto">
          <MobileAppHeader />
          <main className="passbar-main mx-auto w-full max-w-7xl px-4 pb-4 pt-5 md:p-8">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
