"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  PlusCircle, 
  History, 
  Settings, 
  User, 
  BookOpen,
  ChevronDown,
  LayoutGrid,
  ClipboardCheck,
  Wrench,
  RotateCcw,
  HelpCircle,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const NAVIGATION_ITEMS = [
  { 
    name: 'QBank', 
    icon: LayoutGrid, 
    items: [
      { name: 'Create Test', href: '/create', icon: PlusCircle },
      { name: 'Previous Tests', href: '/review', icon: History },
      { name: 'Performance', href: '/performance', icon: BookOpen },
    ]
  },
  { name: 'Assessments', icon: ClipboardCheck, items: [] },
  { name: 'Tools', icon: Wrench, items: [] },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar className="bg-[#1a2b3c] border-r-0">
      <SidebarHeader className="p-6">
        <Link href="/" className="flex flex-col gap-1 items-center mb-8">
          <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center text-white font-bold mb-2">
            <Zap className="w-8 h-8" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">PassBar</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MBE QBank</span>
          <span className="text-xs text-slate-400 mt-2">Bar prep workspace</span>
        </Link>
      </SidebarHeader>
      
      <SidebarContent className="px-0">
        <SidebarMenu className="gap-0">
          {NAVIGATION_ITEMS.map((section) => (
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
              ) : (
                <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
                  <section.icon className="w-4 h-4" />
                  <span className="flex-1 font-semibold text-xs uppercase tracking-wider">{section.name}</span>
                  <ChevronDown className="w-3 h-3 text-slate-500 rotate-270" />
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}

          <SidebarMenuItem>
            <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
              <RotateCcw className="w-4 h-4" />
              <span className="flex-1 font-semibold text-xs uppercase tracking-wider">Reset Options</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          
          <SidebarMenuItem>
            <SidebarMenuButton className="text-slate-300 hover:text-white hover:bg-white/5 py-6 px-4">
              <HelpCircle className="w-4 h-4" />
              <span className="flex-1 font-semibold text-xs uppercase tracking-wider">Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-4 bg-black/20 text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Expiration Date</p>
        <p className="text-[10px] text-slate-300">Mar 05, 2026 12:00 AM EDT</p>
      </SidebarFooter>
    </Sidebar>
  );
}
