"use client";

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Cloud, Languages, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/components/AuthProvider';
import { toast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';
import {
  defaultStudySettings,
  getStudySettings,
  saveStudySettings,
  type ContentMode,
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
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const settings = getStudySettings();
    setInterfaceLanguage(settings.interfaceLanguage);
    setContentMode(settings.contentMode);
    setTextSize(settings.textSize);

    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<StudySettings>).detail;
      if (!next) return;
      setInterfaceLanguage(next.interfaceLanguage);
      setContentMode(next.contentMode);
      setTextSize(next.textSize);
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
    setTextSize(nextSettings.textSize);
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

  const currentSettings: StudySettings = { interfaceLanguage, contentMode, textSize };

  const contentModes: Array<{
    value: ContentMode;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      value: 'english',
      title: t('settings.englishQuestion'),
      description: t('settings.englishQuestionDescription'),
      icon: BookOpen,
    },
    {
      value: 'bilingual',
      title: t('settings.bilingualQuestion'),
      description: t('settings.bilingualQuestionDescription'),
      icon: Languages,
    },
  ];

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
            onValueChange={(value) => commitSettings({ ...currentSettings, interfaceLanguage: value as InterfaceLanguage })}
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
        <CardContent className="space-y-6">
          <RadioGroup
            value={contentMode}
            onValueChange={(value) => commitSettings({ ...currentSettings, contentMode: value as ContentMode })}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {contentModes.map((mode) => {
                const Icon = mode.icon;
                const selected = contentMode === mode.value;

                return (
                  <Label
                    key={mode.value}
                    htmlFor={mode.value}
                    className={cn(
                      'flex cursor-pointer gap-4 rounded-md border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <RadioGroupItem id={mode.value} value={mode.value} className="mt-1" />
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-5 w-5', selected ? 'text-primary' : 'text-slate-500')} />
                        <span className="text-sm font-semibold text-slate-900">{mode.title}</span>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">{mode.description}</p>
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
            Restore Defaults
          </Button>
        </CardContent>
      </Card>

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
