"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  PlusCircle, 
  History, 
  BookOpen,
  ChevronDown,
  LayoutGrid,
  CirclePlay,
  Wrench,
  HelpCircle,
  LogOut,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { BrandLogo } from '@/components/BrandLogo';
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

export function AppSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { t } = useI18n();
  const navigationItems = [
    {
      name: t('nav.qbank'),
      icon: LayoutGrid,
      items: [
        { name: t('nav.createTest'), href: '/create', icon: PlusCircle },
        { name: t('nav.previousTests'), href: '/review', icon: History },
        { name: t('nav.performance'), href: '/performance', icon: BookOpen },
      ],
    },
    { name: t('nav.tutorial'), href: '/tutorial', icon: CirclePlay, items: [] },
    { name: t('nav.tools'), icon: Wrench, items: [
      { name: t('nav.settings'), href: '/settings', icon: Settings },
    ] },
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
      <SidebarHeader className="p-6">
        <Link href="/" className="flex flex-col gap-1 items-center mb-8">
          <BrandLogo className="mb-2 h-14 w-14 rounded-xl bg-white p-2 shadow-sm" />
          <span className="text-xl font-bold tracking-tight text-white">PassBar</span>
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
                    <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
                      <section.icon className="w-4 h-4" />
                      <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                      <ChevronDown className="w-3 h-3 text-slate-500" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1">
                      {section.items.map((item) => (
                        <Link 
                          key={item.href} 
                          href={item.href}
                          onClick={handleNavigate}
                          className={cn(
                            "flex items-center gap-3 pl-10 pr-4 py-3 text-xs transition-colors",
                            pathname === item.href 
                              ? "bg-white/10 text-white border-l-2 border-primary" 
                              : "text-slate-400 hover:text-white hover:bg-white/5"
                          )}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{item.name}</span>
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : section.href ? (
                <Link
                  href={section.href}
                  onClick={handleNavigate}
                  className={cn(
                    "flex items-center gap-3 py-6 px-4 text-slate-300 transition-colors hover:bg-white/5 hover:text-white",
                    pathname === section.href && "bg-white/10 text-white border-l-2 border-primary"
                  )}
                >
                  <section.icon className="w-4 h-4" />
                  <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                </Link>
              ) : (
                <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
                  <section.icon className="w-4 h-4" />
                  <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
              <HelpCircle className="w-4 h-4" />
              <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{t('nav.help')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="hidden space-y-3 bg-black/20 p-4 md:flex">
        <div className="flex items-center gap-3 rounded-md bg-white/5 p-2 text-left">
          <Avatar className="h-9 w-9 border border-white/10">
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-200">{displayName}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{role === 'student' ? t('role.student') : role}</p>
          </div>
        </div>
        <Button
          className="w-full justify-start gap-2 border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white"
          variant="outline"
          size="sm"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {t('auth.signOut')}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
