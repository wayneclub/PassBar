"use client";

import React, { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  REPORT_CATEGORIES, ReportCategory, submitQuestionReport,
} from '@/lib/question-reports';
import { cn } from '@/lib/utils';

interface ReportQuestionDialogProps {
  questionId: string;
  userId: string;
  /** Current interface/explanation language, recorded with the report */
  language: string;
  /** If provided, the dialog is controlled externally (no internal trigger button shown) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Pass className to the trigger button (only used when uncontrolled) */
  triggerClassName?: string;
}

export function ReportQuestionDialog({ questionId, userId, language, open: openProp, onOpenChange, triggerClassName }: ReportQuestionDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const toggleCategory = (value: ReportCategory) => {
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  };

  const handleSubmit = async () => {
    if (categories.length === 0) return;
    setSubmitting(true);
    const ok = await submitQuestionReport({ questionId, userId, categories, language, message });
    setSubmitting(false);
    if (ok) { setDone(true); setTimeout(() => { setOpen(false); setDone(false); setMessage(''); setCategories([]); }, 1500); }
  };

  return (
    <>
      {!isControlled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className={cn('gap-1.5 text-xs text-slate-400 hover:text-slate-600', triggerClassName)}
        >
          <Flag className="h-3.5 w-3.5" />
          回報題目問題
        </Button>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!submitting) setOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-amber-500" />
              回報題目問題
            </DialogTitle>
            <DialogDescription>請選擇問題類型，幫助我們改善題庫品質。</DialogDescription>
          </DialogHeader>

          {done ? (
            <p className="py-4 text-center text-sm font-medium text-green-600">✓ 已送出，感謝你的回報！</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {REPORT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => toggleCategory(cat.value)}
                    aria-pressed={categories.includes(cat.value)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
                      categories.includes(cat.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <Textarea
                placeholder="補充說明（選填）"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>取消</Button>
                <Button size="sm" onClick={handleSubmit} disabled={submitting || categories.length === 0}>
                  {submitting ? '送出中…' : '送出回報'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
