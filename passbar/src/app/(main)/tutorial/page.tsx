"use client";

import { CirclePlay } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function TutorialPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="rounded-lg border border-slate-200 bg-white px-6 py-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
            <CirclePlay className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-800">{t('nav.tutorial')}</h1>
        </div>
      </div>
    </div>
  );
}
