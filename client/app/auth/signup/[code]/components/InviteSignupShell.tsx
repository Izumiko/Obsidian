'use client';

import { useParams, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { API_BASE_URL } from '@/lib/api';
import { useI18n } from '@/app/hooks/useI18n';
import AuthCard from '../../../shared/AuthCard';
import { LanguageSelector } from '../../../../components/LanguageSelector';
import { SignUpForm } from '../../components/SignUpForm';

type ValidInviteInfo = {
  valid: true;
  code: string;
  createdAt: string;
  expiresAt?: string | null;
  createdBy?: { id: string; username: string } | null;
  usedById?: string | null;
};

type InvalidInviteInfo = { valid: false };
type InviteInfo = ValidInviteInfo | InvalidInviteInfo;

function isValidInvite(info: InviteInfo): info is ValidInviteInfo {
  return info.valid === true;
}

export default function InviteSignupShell() {
  const { t, language } = useI18n();
  const params = useParams();
  const pathname = usePathname();

  let code = typeof params?.code === 'string'
    ? params.code
    : (Array.isArray(params?.code) ? params.code[0] : '');
  if (!code || code === '_placeholder') {
    code = decodeURIComponent(pathname.split('/').filter(Boolean)[2] || '');
  }

  const { data, error, isLoading } = useSWR<InviteInfo>(
    code ? `${API_BASE_URL}/invite/${code}` : null,
    async (key: string) => {
      const res = await fetch(key);
      if (!res.ok) return { valid: false };
      return res.json();
    }
  );

  const title = t('auth.register.title');

  const serverTranslations = {
    title,
    usernameLabel: t('auth.register.username'),
    emailLabel: t('auth.register.email'),
    passwordLabel: t('auth.register.password'),
    confirmPasswordLabel: t('auth.register.confirmPassword'),
    submitButton: t('auth.register.submit'),
    hasAccount: t('auth.register.hasAccount'),
    loginLink: t('auth.register.login'),
    usernameError: t('auth.register.errors.username'),
    emailError: t('auth.register.errors.email'),
    passwordRequirementsError: t('auth.register.errors.passwordRequirements'),
    passwordMatchError: t('auth.register.errors.passwordMatch'),
    invalidCredentialsError: t('auth.register.errors.invalidCredentials'),
    successRegister: t('auth.notification.successRegister'),
    errorNotification: t('auth.notification.error'),
    usernamePlaceholder: t('auth.placeholders.username'),
    emailPlaceholder: t('auth.placeholders.email'),
    passwordPlaceholder: t('auth.placeholders.password'),
    confirmPasswordPlaceholder: t('auth.placeholders.confirmPassword'),
    registerLoading: t('auth.register.loading'),
    registrationClosedTitle: t('auth.register.registrationClosed'),
    registrationClosedMessage: t('auth.register.registrationClosedMessage'),
    registrationClosedDescription: t('auth.register.registrationClosedDescription'),
    goToLogin: t('auth.register.goToLogin'),
    alreadyHaveAccount: t('auth.register.alreadyHaveAccount'),
    signInHere: t('auth.register.signInHere'),
    securityRecommendations: t('auth.register.securityRecommendations'),
    weak: t('auth.register.passwordStrength.weak'),
    fair: t('auth.register.passwordStrength.fair'),
    good: t('auth.register.passwordStrength.good'),
    strong: t('auth.register.passwordStrength.strong'),
    minLength: t('auth.register.passwordRequirements.minLength'),
    uppercase: t('auth.register.passwordRequirements.uppercase'),
    lowercase: t('auth.register.passwordRequirements.lowercase'),
    number: t('auth.register.passwordRequirements.number'),
    special: t('auth.register.passwordRequirements.special'),
    inviteOnlyTitle: t('auth.register.inviteOnly.title'),
    inviteOnlyMessage: t('auth.register.inviteOnly.message'),
  };

  const inviteInfo: InviteInfo = (!error && data) ? data : { valid: false };
  const loading = isLoading || !code;

  return (
    <>
      <AuthCard title={title}>
        {loading ? (
          <div className="p-4 rounded border border-border bg-surface">
            <div className="animate-pulse h-4 w-full bg-surface-secondary rounded" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded border border-border bg-surface">
              {isValidInvite(inviteInfo) ? (
                <div className="text-sm text-text">
                  <div><span className="text-text-secondary">{t('auth.register.inviteBanner.invitedBy')}:</span> <span className="font-semibold">{inviteInfo.createdBy?.username || '—'}</span></div>
                  <div><span className="text-text-secondary">{t('auth.register.inviteBanner.code')}:</span> <span className="font-mono">{inviteInfo.code}</span></div>
                  <div><span className="text-text-secondary">{t('auth.register.inviteBanner.expires')}:</span> <span className="text-green font-semibold">{inviteInfo.expiresAt ? new Date(inviteInfo.expiresAt).toLocaleString() : '—'}</span></div>
                </div>
              ) : (
                <div className="text-error">{t('auth.register.inviteBanner.invalid')}</div>
              )}
            </div>
            {isValidInvite(inviteInfo) && (
              <SignUpForm registrationMode="INVITE" inviteCode={inviteInfo.code} hideInviteUi serverTranslations={serverTranslations} />
            )}
          </div>
        )}
      </AuthCard>
      <LanguageSelector currentLanguage={language} />
    </>
  );
}
