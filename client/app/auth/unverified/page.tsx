'use client';

import AuthCard from '../shared/AuthCard';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import ResendVerificationButton from './components/ResendVerificationButton.client';
import LogoutButton from './components/LogoutButton.client';
import { useI18n } from '@/app/hooks/useI18n';

export default function UnverifiedPage() {
  const { t, language } = useI18n();
  const title = t('auth.unverified.title');
  const message = t('auth.unverified.message');
  const resend = t('auth.unverified.resend');

  return (
    <>
      <AuthCard title={title}>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">{message}</p>
          <div className="flex gap-2">
            <ResendVerificationButton label={resend} />
            <LogoutButton label={t('auth.login.logout')} toast={t('auth.notification.successLogout')} />
          </div>
        </div>
      </AuthCard>
      <LanguageSelector currentLanguage={language} />
    </>
  );
}
