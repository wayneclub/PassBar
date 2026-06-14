"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  PlusCircle,
  History,
  BookOpen,
  Brain,
  Swords,
  ChevronDown,
  HelpCircle,
  LogOut,
  Settings,
  Shield,
  Users,
  LayoutDashboard,
  GraduationCap,
  Flag,
  Footprints,
  BarChart2,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { BrandLogo } from '@/components/BrandLogo';
import { NotificationBell } from '@/components/NotificationBell';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type NavigationItem = {
  name: string;
  icon: LucideIcon;
  href?: string;
  tourId?: string;
  items: Array<{
    name: string;
    href: string;
    icon: LucideIcon;
    tourId?: string;
  }>;
};

export function AppSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { t } = useI18n();
  const navigationItems: NavigationItem[] = [
    { name: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard, items: [] },
    {
      name: t('nav.conceptAbsorption'),
      icon: Brain,
      tourId: 'qbank',
      items: [
        { name: t('nav.browse'), href: '/topic-study', icon: BookOpen, tourId: 'concept-items' },
        { name: t('nav.footprint'), href: '/footprint', icon: Footprints, tourId: 'concept-items' },
      ],
    },
    {
      name: t('nav.practiceTraining'),
      icon: Swords,
      items: [
        { name: t('nav.createTest'), href: '/create', icon: PlusCircle, tourId: 'create-test' },
        { name: t('nav.simExam'), href: '/sim-exam', icon: GraduationCap },
        { name: t('nav.previousTests'), href: '/review', icon: History, tourId: 'practice-review-items' },
        { name: t('nav.performance'), href: '/performance', icon: BarChart2, tourId: 'practice-review-items' },
      ],
    },
    { name: t('nav.settings'), href: '/settings', icon: Settings, items: [], tourId: 'settings' },
  ];
  const displayName = profile?.full_name || profile?.email || user?.email || 'Signed in';
  const role = profile?.role || 'student';
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'PB';
  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar className="bg-secondary border-r-0">
      <SidebarHeader className="px-4 pb-2 pt-4">
        <Link href="/" className="flex flex-col items-center gap-0.5">
          <BrandLogo className="mb-1.5 h-12 w-12 rounded-lg bg-white p-1.5 shadow-sm" />
          <span className="text-lg font-bold tracking-tight text-white">PassBar</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MBE QBank</span>
        </Link>
      </SidebarHeader>
      
      <SidebarContent className="px-0">
        <SidebarMenu className="gap-0">
          {navigationItems.map((section) => (
            <SidebarMenuItem key={section.name} className="px-0">
              {section.items.length > 0 ? (
                <Collapsible defaultOpen className="w-full">
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton data-tour={section.tourId} className="h-auto gap-3 text-slate-300 hover:text-white hover:bg-white/5 py-4 px-4">
                      <section.icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                      <ChevronDown className="w-3 h-3 text-slate-500" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-0.5 pb-1">
                      {section.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          data-tour={item.tourId}
                          onClick={handleNavigate}
                          className={cn(
                            "flex items-center gap-3 pl-10 pr-4 py-3.5 text-xs transition-colors",
                            pathname === item.href
                              ? "bg-white/10 text-white border-l-2 border-primary"
                              : "text-slate-400 hover:text-white hover:bg-white/5"
                          )}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span>{item.name}</span>
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : section.href ? (
                <Link
                  href={section.href}
                  data-tour={section.tourId}
                  onClick={handleNavigate}
                  className={cn(
                    "flex items-center gap-3 py-4 px-4 text-slate-300 transition-colors hover:bg-white/5 hover:text-white",
                    pathname === section.href && "bg-white/10 text-white border-l-2 border-primary"
                  )}
                >
                  <section.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                </Link>
              ) : (
                <SidebarMenuButton className="h-auto gap-3 text-slate-300 hover:text-white hover:bg-white/5 py-4 px-4">
                  <section.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <Link
              href="/help"
              onClick={handleNavigate}
              className={cn(
                "flex items-center gap-3 py-4 px-4 text-slate-300 transition-colors hover:bg-white/5 hover:text-white",
                pathname === '/help' && "bg-white/10 text-white border-l-2 border-primary"
              )}
            >
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{t('nav.help')}</span>
            </Link>
          </SidebarMenuItem>
          {profile?.role === 'admin' && (
            <SidebarMenuItem className="px-0 pt-1">
              <div className="mx-4 mb-1 border-t border-white/10" />
              <Collapsible defaultOpen className="w-full">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="h-auto gap-3 text-amber-400 hover:text-amber-300 hover:bg-white/5 py-4 px-4">
                    <Shield className="w-4 h-4" />
                    <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{t('admin.sidebarTitle')}</span>
                    <ChevronDown className="w-3 h-3 text-amber-600" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5 pb-1">
                    {[
                      { href: '/admin', label: t('admin.dashboardTitle'), icon: LayoutDashboard, exact: true },
                      { href: '/admin/users', label: t('admin.usersTitle'), icon: Users, exact: false },
                      { href: '/admin/questions', label: t('admin.reportsTitle'), icon: Flag, exact: false },
                    ].map((item) => {
                      const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={handleNavigate}
                          className={cn(
                            "flex items-center gap-3 pl-10 pr-4 py-3.5 text-xs transition-colors",
                            active
                              ? "bg-amber-500/10 text-amber-300 border-l-2 border-amber-400"
                              : "text-amber-500/60 hover:text-amber-300 hover:bg-white/5"
                          )}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="hidden space-y-3 bg-black/20 p-4 md:flex">
        <div className="flex items-center gap-2 rounded-md bg-white/5 p-2">
          <Link
            href="/profile"
            data-tour="profile"
            onClick={handleNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md transition-colors hover:bg-white/5"
          >
            <Avatar className="h-9 w-9 border border-white/10 !bg-primary">
              <AvatarFallback className="!bg-primary text-xs font-bold !text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-200">{displayName}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-500">{role === 'student' ? t('role.student') : role}</p>
            </div>
          </Link>
          <NotificationBell variant="dark" size="sm" align="start" side="right" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
