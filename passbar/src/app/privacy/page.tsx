import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

export const metadata = {
  title: 'Privacy Policy — PassBar',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link href="/auth">
            <BrandLogo variant="wordmark" className="h-10" />
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-400">Last updated: June 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-slate-600">
          <section>
            <h2 className="mb-2 font-semibold text-slate-900">1. Information We Collect</h2>
            <p>When you sign in with Google, we receive your name and email address. We store this to identify your account and personalise your experience.</p>
            <p className="mt-3">We also collect data you generate while using PassBar — including your answers, flagged questions, test sessions, and performance history — so we can show you progress over time.</p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">2. Cookies & Similar Technologies</h2>
            <p>PassBar uses cookies and browser storage strictly to keep you signed in between sessions. We do not use third-party advertising cookies. Session cookies are managed via Supabase.</p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">3. How We Use Your Information</h2>
            <ul className="mt-1 space-y-1.5">
              {[
                'To authenticate you and maintain your session',
                'To save and display your study history and performance',
                'To improve the app based on aggregate, anonymised usage patterns',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">4. Data Sharing</h2>
            <p>We do not sell or share your personal data for marketing purposes. We use Supabase (database & auth) and Vercel (hosting) as infrastructure providers — they process data only to deliver our service.</p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">5. Data Retention</h2>
            <p>Your data is retained for as long as your account is active. You may request deletion of your account and all associated data at any time by contacting us.</p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">6. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to access, correct, or delete the personal data we hold about you. Contact us to exercise any of these rights.</p>
          </section>
        </div>

        <div className="mt-12 border-t border-slate-200 pt-6">
          <Link href="/auth" className="text-sm text-slate-500 hover:text-slate-800">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
