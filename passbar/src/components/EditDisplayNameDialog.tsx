"use client";

import React, { useEffect, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

export function EditDisplayNameDialog({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { user, profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDisplayName(profile?.full_name ?? '');
  }, [open, profile?.full_name]);

  const handleSave = async () => {
    if (!user?.id || !supabase) return;
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: trimmed })
      .eq('id', user.id);
    setSaving(false);
    if (error && !error.message.includes('204')) {
      console.error('[PassBar] Update display name error:', error);
      toast({ title: t('settings.nameUpdateFailed'), description: error.message, variant: 'destructive' });
    } else {
      await refreshProfile();
      toast({ title: t('settings.nameUpdated') });
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            {t('settings.profile')}
          </DialogTitle>
          <DialogDescription>{t('settings.profileDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="dialog-display-name">{t('settings.displayName')}</Label>
          <Input
            id="dialog-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('settings.displayNamePlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t('dashboard.examDateCancel')}</Button>
          <Button onClick={handleSave} disabled={saving || !displayName.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? t('settings.updating') : t('settings.updateName')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
