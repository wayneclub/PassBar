import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AuthGuard } from '@/components/AuthGuard';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider className="h-screen min-h-0 overflow-hidden">
        <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background">
          <AppSidebar />
          <SidebarInset className="h-screen min-h-0 flex-1 overflow-y-auto">
            <main className="passbar-main mx-auto w-full max-w-7xl p-4 md:p-8">
              {children}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
