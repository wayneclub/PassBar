"use client";

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Cloud, Languages, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/components/AuthProvider';
import { toast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';
import { clearUserProgress } from '@/lib/question-progress';
import {
  defaultStudySettings,
  getStudySettings,
  saveStudySettings,
  type ContentMode,
  type DisplayOptions,
  type InterfaceLanguage,
  type StudySettings,
  type TextSize,
} from '@/lib/study-settings';
import { saveUserStudySettings } from '@/lib/user-settings';
import { cn } from '@/lib/utils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function SettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [interfaceLanguage, setInterfaceLanguage] = useState<InterfaceLanguage>('en');
  const [contentMode, setContentMode] = useState<ContentMode>('english');
  const [display, setDisplay] = useState<DisplayOptions>(defaultStudySettings.display);
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [showNotes, setShowNotes] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimerRef = useRef<number | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearScope, setClearScope] = useState<'practice' | 'browse' | 'all'>('all');

  useEffect(() => {
    const settings = getStudySettings();
    setInterfaceLanguage(settings.interfaceLanguage);
    setContentMode(settings.contentMode);
    setDisplay(settings.display);
    setTextSize(settings.textSize);
    setShowNotes(settings.showNotes);

    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<StudySettings>).detail;
      if (!next) return;
      setInterfaceLanguage(next.interfaceLanguage);
      setContentMode(next.contentMode);
      setDisplay(next.display);
      setTextSize(next.textSize);
      setShowNotes(next.showNotes);
    };

    window.addEventListener('passbar-study-settings-changed', handleSettingsChange);
    return () => {
      window.removeEventListener('passbar-study-settings-changed', handleSettingsChange);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const commitSettings = (nextSettings: StudySettings) => {
    saveStudySettings(nextSettings);
    setInterfaceLanguage(nextSettings.interfaceLanguage);
    setContentMode(nextSettings.contentMode);
    setDisplay(nextSettings.display);
    setTextSize(nextSettings.textSize);
    setShowNotes(nextSettings.showNotes);
    setSaveStatus('saving');

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      const ok = user?.id ? await saveUserStudySettings(user.id, nextSettings) : true;
      setSaveStatus(ok ? 'saved' : 'error');
      toast({
        title: ok ? t('settings.saved') : t('settings.saveFailed'),
        description: ok ? t('settings.savedDescription') : undefined,
        variant: ok ? 'default' : 'destructive',
      });
      window.setTimeout(() => setSaveStatus('idle'), 2200);
    }, 500);
  };

  const currentSettings: StudySettings = { interfaceLanguage, contentMode, display, textSize, showNotes };

  function isLastQA(flagKey: keyof DisplayOptions) {
    if (flagKey !== 'enQA' && flagKey !== 'zhQA') return false;
    const other: keyof DisplayOptions = flagKey === 'enQA' ? 'zhQA' : 'enQA';
    return display[flagKey] && !display[other];
  }

  function isLastExp(flagKey: keyof DisplayOptions) {
    if (flagKey !== 'enExplanation' && flagKey !== 'zhExplanation') return false;
    const other: keyof DisplayOptions = flagKey === 'enExplanation' ? 'zhExplanation' : 'enExplanation';
    return display[flagKey] && !display[other];
  }

  function DisplayCheckbox({ flagKey, label }: { flagKey: keyof DisplayOptions; label: string }) {
    const checked = display[flagKey];
    const locked = checked && (isLastQA(flagKey) || isLastExp(flagKey));
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={locked}
        onClick={() => {
          if (locked) return;
          commitSettings({ ...currentSettings, display: { ...display, [flagKey]: !checked } });
        }}
        className={cn(
          'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm font-medium transition-colors',
          checked ? 'border-primary bg-primary/5 text-slate-900' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
          locked && 'cursor-not-allowed opacity-60',
        )}
      >
        <div className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 bg-white',
        )}>
          {checked && (
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 12 12">
              <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        {label}
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold text-primary">{t('settings.title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('settings.description')}</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t('settings.interfaceLanguage')}</CardTitle>
          <CardDescription>{t('settings.interfaceLanguageDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={interfaceLanguage}
            onValueChange={(value) => {
              const lang = value as InterfaceLanguage;
              const isChinese = lang === 'zh-Hans' || lang === 'zh-Hant';
              const nextDisplay = isChinese
                ? { ...currentSettings.display, zhQA: true, zhExplanation: true }
                : { ...currentSettings.display, enQA: true, enExplanation: true };
              commitSettings({ ...currentSettings, interfaceLanguage: lang, display: nextDisplay });
            }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { value: 'en', label: t('settings.english') },
                { value: 'zh-Hans', label: t('settings.simplifiedChinese') },
                { value: 'zh-Hant', label: t('settings.traditionalChinese') },
              ].map((item) => {
                const selected = interfaceLanguage === item.value;
                return (
                  <Label
                    key={item.value}
                    htmlFor={`lang-${item.value}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <RadioGroupItem id={`lang-${item.value}`} value={item.value} />
                    <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                  </Label>
                );
              })}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t('settings.questionDisplay')}</CardTitle>
          <CardDescription>{t('settings.questionDisplayDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {/* EN column */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <BookOpen className="h-3.5 w-3.5" />
                {t('settings.english')}
              </p>
              <DisplayCheckbox flagKey="enQA"          label={t('settings.displayQA')} />
              <DisplayCheckbox flagKey="enExplanation" label={t('settings.displayExplanation')} />
            </div>

            {/* ZH column */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Languages className="h-3.5 w-3.5" />
                {t('settings.chinese')}
              </p>
              <DisplayCheckbox flagKey="zhQA"          label={t('settings.displayQA')} />
              <DisplayCheckbox flagKey="zhExplanation" label={t('settings.displayExplanation')} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t('settings.textSize')}</CardTitle>
          <CardDescription>{t('settings.textSizeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup
            value={textSize}
            onValueChange={(value) => commitSettings({ ...currentSettings, textSize: value as TextSize })}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { value: 'medium', label: t('settings.medium'), preview: t('settings.comfortableReading') },
                { value: 'large', label: t('settings.large'), preview: t('settings.largerReading') },
              ].map((item) => {
                const selected = textSize === item.value;
                return (
                  <Label
                    key={item.value}
                    htmlFor={`text-${item.value}`}
                    className={cn(
                      'cursor-pointer rounded-md border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <RadioGroupItem id={`text-${item.value}`} value={item.value} className="mt-1" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                        <div
                          className={cn(
                            'mt-2 leading-normal text-slate-600',
                            item.value === 'medium' && 'text-lg',
                            item.value === 'large' && 'text-xl',
                          )}
                        >
                          {item.preview}
                        </div>
                      </div>
                    </div>
                  </Label>
                );
              })}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t('settings.studyModeTitle')}</CardTitle>
          <CardDescription>{t('settings.studyNotes')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup
            value={showNotes ? 'notes' : 'exam'}
            onValueChange={(value) => commitSettings({ ...currentSettings, showNotes: value === 'notes' })}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { value: 'notes', label: t('settings.studyNotesOn') },
                { value: 'exam', label: t('settings.studyNotesOff') },
              ].map((item) => {
                const selected = (item.value === 'notes') === showNotes;
                return (
                  <Label
                    key={item.value}
                    htmlFor={`notes-${item.value}`}
                    className={cn(
                      'cursor-pointer rounded-md border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <RadioGroupItem id={`notes-${item.value}`} value={item.value} className="mt-1" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                      </div>
                    </div>
                  </Label>
                );
              })}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{t('nav.resetOptions')}</CardTitle>
          <CardDescription>{t('settings.autoSaveHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            onClick={() => commitSettings(defaultStudySettings)}
          >
            <RotateCcw className="h-4 w-4" />
            {t('settings.restoreDefaults')}
          </Button>
        </CardContent>
      </Card>

      {/* Clear Progress Card */}
      <Card className="border-red-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="h-4 w-4" />
            {t('settings.clearProgress')}
          </CardTitle>
          <CardDescription>{t('settings.clearProgressDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {([
            { scope: 'practice' as const, label: t('settings.clearPractice'), desc: t('settings.clearPracticeDescription') },
            { scope: 'browse' as const, label: t('settings.clearBrowse'), desc: t('settings.clearBrowseDescription') },
            { scope: 'all' as const, label: t('settings.clearAll'), desc: t('settings.clearAllDescription') },
          ]).map(({ scope, label, desc }) => (
            <div key={scope} className="flex items-start justify-between gap-4 rounded-lg border border-red-100 bg-red-50/40 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-700">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                onClick={() => { setClearScope(scope); setClearConfirmText(''); setClearDialogOpen(true); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {label}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Clear Progress Confirmation Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={(open) => { if (!clearing) { setClearDialogOpen(open); setClearConfirmText(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">{t('settings.clearProgressConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('settings.clearProgressConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-slate-500">{t('settings.clearProgressConfirmHint')}</p>
            <Input
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder={t('settings.clearProgressConfirmPlaceholder')}
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && clearConfirmText.trim().toLowerCase() === 'reset') {
                  setClearing(true);
                  const ok = await clearUserProgress(user!.id, clearScope);
                  setClearing(false);
                  setClearDialogOpen(false);
                  toast({ title: ok ? t('settings.clearProgressSuccess') : t('settings.clearProgressFailed'), variant: ok ? 'default' : 'destructive' });
                  if (ok) setTimeout(() => window.location.reload(), 800);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialogOpen(false)} disabled={clearing}>
              {t('dashboard.examDateCancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={clearing || clearConfirmText.trim().toLowerCase() !== 'reset'}
              onClick={async () => {
                setClearing(true);
                const ok = await clearUserProgress(user!.id, clearScope);
                setClearing(false);
                setClearDialogOpen(false);
                toast({ title: ok ? t('settings.clearProgressSuccess') : t('settings.clearProgressFailed'), variant: ok ? 'default' : 'destructive' });
                if (ok) setTimeout(() => window.location.reload(), 800);
              }}
            >
              {clearing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('settings.clearing')}</> : <><Trash2 className="mr-2 h-4 w-4" />{t('settings.clearProgress')}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm backdrop-blur">
          {saveStatus === 'saving' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {t('settings.saving')}
            </>
          ) : saveStatus === 'saved' ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t('settings.saved')}
            </>
          ) : (
            <>
              <Cloud className="h-4 w-4 text-primary" />
              {saveStatus === 'error' ? t('settings.saveFailed') : t('settings.autoSaveHint')}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
