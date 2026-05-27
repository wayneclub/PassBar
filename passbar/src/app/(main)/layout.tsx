import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AuthGuard } from '@/components/AuthGuard';
import { MobileAppHeader } from '@/components/MobileAppHeader';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
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
    </AuthGuard>
  );
}
