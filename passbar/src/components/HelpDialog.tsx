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

const PACING_SECONDS = 108;

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function MbePacingTool() {
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
        <p className="text-base font-bold">108 秒配速模擬器</p>
        <p className="text-xs text-gray-400 mt-1">點擊開始，親身體驗寫完一題 MBE 所擁有的時間（1.8 分鐘倒數）。</p>
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
          {running ? '暫停' : '開始配速體驗'}
        </Button>
        <Button variant="outline" size="icon" onClick={reset} className="border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

const STEPS = [
  {
    num: '01',
    title: '建立自訂練習',
    desc: '點擊「建立測驗」，選擇目標科目（如 Civil Procedure）與題數，快速拼湊出弱點考科考卷。',
  },
  {
    num: '02',
    title: '訓練 1.8 分鐘直覺',
    desc: 'MBE 考試中平均每題僅有 **108 秒** 答題時間。練習時請務必緊計時，鍛鍊迅速刪除誘餌選項的直覺。',
  },
  {
    num: '03',
    title: '覆盤錯題本',
    desc: '在「學習表現」中找出弱點科目，點擊歷史錯題重新覆核解析，這才是分數暴漲的黃金閉環。',
  },
];

const FAQS = [
  {
    q: '為什麼我無法登入？忘記密碼如何重設？',
    a: '請點擊登入頁面的「忘記密碼」連結，輸入您的電子信箱，系統將寄送重設密碼信件。若仍無法登入，請透過下方系統建議表單聯繫我們。',
  },
  {
    q: '支援在 iPad 或是手機瀏覽器上刷題嗎？',
    a: '支援！PassBar 採用響應式設計，可在 iPad 及手機瀏覽器上正常使用。建議使用 Chrome 或 Safari 最新版以獲得最佳體驗。',
  },
  {
    q: '題目來源是什麼？是否符合最新 MBE 考試大綱？',
    a: '題目依據 NCBE 公布的最新 MBE 考試大綱設計，涵蓋全部七大科目，定期更新以確保與最新考試規格一致。',
  },
  {
    q: '寫題寫到一半關閉頁面，答題記錄會消失嗎？',
    a: '不會！作答進度會即時自動儲存。重新開啟頁面後，可在「歷史測驗」中找到未完成的測驗並繼續作答。',
  },
];

const FEEDBACK_CATEGORIES = [
  '題目勘誤與錯字（Content Correction）',
  '系統錯誤（Bug Report）',
  '功能建議（Feature Request）',
  '帳號與付款問題（Account / Billing）',
  '其他（Other）',
];

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0]);
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
      toast({ title: '感謝您的回報，我們會盡快處理！' });
      setQid('');
      setMessage('');
    } catch {
      toast({ title: '送出失敗，請稍後再試。', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">幫助與備考指引中心</DialogTitle>
            <span className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
              距離 2026 年美國律師考試 (Bar Exam) 衝刺中
            </span>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-8">
          {/* Quick Start */}
          <section>
            <h2 className="flex items-center gap-2 text-sm font-bold text-primary mb-4">
              <Rocket className="w-4 h-4" />
              快速上手 PASSBAR 指南
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 md:col-span-3 gap-4">
                {STEPS.map((step) => (
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
              備考與技術常見問答
            </h2>
            <Accordion type="single" collapsible className="border rounded-xl overflow-hidden">
              {FAQS.map((faq, i) => (
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
              系統建議
            </h2>
            <form onSubmit={handleSubmit} className="border rounded-xl p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">回報類別 <span className="text-destructive">*</span></Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">題號 QID（選填）</Label>
                  <Input placeholder="例如: 1024" value={qid} onChange={(e) => setQid(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">聯絡 Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">詳細狀況說明 <span className="text-destructive">*</span></Label>
                <Textarea
                  placeholder="請具體寫下您發現的勘誤文字、或操作時發生的系統問題..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? '送出中...' : '送出回報'}
              </Button>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
