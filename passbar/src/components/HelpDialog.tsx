"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Rocket, HelpCircle, MessageSquare, Play, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';

const PACING_SECONDS = 108;

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function MbePacingTool() {
  const { t } = useI18n();
  const [timeLeft, setTimeLeft] = useState(PACING_SECONDS);
  const [running, setRunning] = useState(false);

  const reset = useCallback(() => {
    setRunning(false);
    setTimeLeft(PACING_SECONDS);
  }, []);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) {
      setRunning(false);
      return;
    }
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [running, timeLeft]);

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const secs = String(timeLeft % 60).padStart(2, '0');

  return (
    <div className="rounded-xl bg-gray-900 text-white p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-orange-400 uppercase">
        <span className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
        MBE Pacing Tool
      </div>
      <div>
        <p className="text-base font-bold">{t('help.pacingToolTitle')}</p>
        <p className="text-xs text-gray-400 mt-1">{t('help.pacingToolDescription')}</p>
      </div>
      <div className="text-5xl font-bold tracking-tight text-center py-2">
        {mins}:{secs}
      </div>
      <div className="flex gap-2">
        <Button
          className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-black font-semibold"
          onClick={() => setRunning((r) => !r)}
        >
          <Play className="w-4 h-4 mr-1" />
          {running ? t('help.pause') : t('help.startPacing')}
        </Button>
        <Button variant="outline" size="icon" onClick={reset} className="border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const feedbackCategories: { value: string; label: string }[] = [
    { value: 'content', label: t('help.feedbackCategoryContent') },
    { value: 'bug',     label: t('help.feedbackCategoryBug') },
    { value: 'feature', label: t('help.feedbackCategoryFeature') },
    { value: 'account', label: t('help.feedbackCategoryAccount') },
    { value: 'other',   label: t('help.feedbackCategoryOther') },
  ];
  const steps = [
    { num: '01', title: t('help.step1Title'), desc: t('help.dialogStep1Desc') },
    { num: '02', title: t('help.step2Title'), desc: t('help.dialogStep2Desc') },
    { num: '03', title: t('help.step3Title'), desc: t('help.dialogStep3Desc') },
  ];
  const faqs = [
    { q: t('help.faq.login.q'), a: t('help.faq.login.a') },
    { q: t('help.faq.mobile.q'), a: t('help.faq.mobile.a') },
    { q: t('help.faq.source.q'), a: t('help.faq.source.a') },
    { q: t('help.faq.closePage.q'), a: t('help.faq.closePage.a') },
  ];
  const [category, setCategory] = useState(feedbackCategories[0].value);
  const [qid, setQid] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.email) setEmail(profile.email);
    else if (user?.email) setEmail(user.email);
  }, [profile, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase!.from('feedback').insert({
        user_id: user?.id ?? null,
        category,
        qid: qid || null,
        email,
        message,
      });
      if (error) throw error;
      toast({ title: t('help.dialogFeedbackSuccessToast') });
      setQid('');
      setMessage('');
    } catch {
      toast({ title: t('help.feedbackErrorToast'), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">{t('help.title')}</DialogTitle>
            <span className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
              {t('help.examSprintBadge')}
            </span>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-8">
          {/* Quick Start */}
          <section>
            <h2 className="flex items-center gap-2 text-sm font-bold text-primary mb-4">
              <Rocket className="w-4 h-4" />
              {t('help.quickStartPassbar')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 md:col-span-3 gap-4">
                {steps.map((step) => (
                  <div key={step.num} className="rounded-xl border bg-card p-4 space-y-2">
                    <span className="text-2xl font-bold text-muted-foreground">{step.num}</span>
                    <p className="font-semibold text-sm">{step.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                ))}
              </div>
              <div className="md:col-span-1 min-w-[220px]">
                <MbePacingTool />
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section>
            <h2 className="flex items-center gap-2 text-sm font-bold text-orange-500 mb-4">
              <HelpCircle className="w-4 h-4" />
              {t('help.dialogFaqTitle')}
            </h2>
            <Accordion type="single" collapsible className="border rounded-xl overflow-hidden">
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-b last:border-0 px-4">
                  <AccordionTrigger className="text-sm font-medium py-4 hover:no-underline">
                    <span className="flex gap-2 text-left"><span className="text-muted-foreground font-bold">Q.</span>{faq.q}</span>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground pb-4 pl-6">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          {/* Feedback Form */}
          <section>
            <h2 className="flex items-center gap-2 text-sm font-bold text-blue-500 mb-4">
              <MessageSquare className="w-4 h-4" />
              {t('help.feedbackTitle')}
            </h2>
            <form onSubmit={handleSubmit} className="border rounded-xl p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('help.feedbackCategory')} <span className="text-destructive">*</span></Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {feedbackCategories.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('help.qidOptional')}</Label>
                  <Input placeholder={t('help.qidExample')} value={qid} onChange={(e) => setQid(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('help.contactEmail')} <span className="text-destructive">*</span></Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('help.detailedIssue')} <span className="text-destructive">*</span></Label>
                <Textarea
                  placeholder={t('help.detailedIssuePlaceholder')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? t('help.submitting') : t('help.submitReport')}
              </Button>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
