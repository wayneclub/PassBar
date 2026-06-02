"use client";

import Link from 'next/link';
import { LogOut, Menu, Pencil, Settings } from 'lucide-react';
import { EditDisplayNameDialog } from '@/components/EditDisplayNameDialog';
import { NotificationBell } from '@/components/NotificationBell';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { useSidebar } from '@/components/ui/sidebar';
import { BrandLogo } from '@/components/BrandLogo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function MobileAppHeader() {
  const { t } = useI18n();
  const { profile, signOut, user } = useAuth();
  const { toggleSidebar } = useSidebar();
  const displayName = profile?.full_name || profile?.email || user?.email || 'PassBar';
  const role = profile?.role || 'student';
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'PB';

  return (
    <header className="sticky top-0 z-40 grid min-h-16 grid-cols-[3rem_1fr_auto] items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 shadow-sm md:hidden">
      <Button
        type="button"
        aria-label={t('nav.openNavigation')}
        className="h-11 w-11 rounded-lg bg-secondary p-0 text-white shadow-sm hover:bg-secondary/90"
        onClick={toggleSidebar}
      >
        <Menu className="h-7 w-7" />
      </Button>

      <Link href="/dashboard" className="flex min-w-0 items-center justify-center">
        <BrandLogo variant="wordmark" className="h-12 w-48 max-w-full" />
      </Link>

      <div className="flex items-center gap-2">
        <NotificationBell variant="light" />
        <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-11 w-11 shrink-0 rounded-full outline-none ring-primary/20 transition focus-visible:ring-4 flex items-center justify-center p-0 overflow-hidden"
            aria-label={t('profile.open')}
          >
            <Avatar className="h-11 w-11 border border-primary/25 !bg-primary shadow-sm" title={displayName}>
              <AvatarFallback className="!bg-primary text-sm font-semibold !text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-1">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-primary/25 !bg-primary">
                <AvatarFallback className="!bg-primary text-sm font-semibold !text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                  <EditDisplayNameDialog>
                    <button type="button" className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700 transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditDisplayNameDialog>
                </div>
                <p className="text-xs font-normal uppercase tracking-wider text-slate-500">
                  {role === 'student' ? t('role.student') : role}
                </p>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings className="h-4 w-4" />
              {t('nav.settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            {t('auth.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}
