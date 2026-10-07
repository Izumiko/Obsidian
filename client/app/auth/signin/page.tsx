'use client';

/**
 * Login page component - matches original tracker design
 * Client Component with client-side translations
 */

import { Suspense } from 'react';
import AuthCard from '../shared/AuthCard';
import SignInForm from './components/SignInForm';
import { FormFieldSkeleton, ButtonSkeleton, TextSkeleton } from '../../components/ui/Skeleton';
import { LanguageSelector } from '../../components/LanguageSelector';
import { useI18n } from '../../hooks/useI18n';

function SignInLoading({ loginLabel, passwordLabel, loginPlaceholder, passwordPlaceholder }: { loginLabel: string; passwordLabel: string; loginPlaceholder: string; passwordPlaceholder: string }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <FormFieldSkeleton label={loginLabel} placeholder={loginPlaceholder} />
        <FormFieldSkeleton label={passwordLabel} placeholder={passwordPlaceholder} />
        <ButtonSkeleton />
      </div>
      <div className="space-y-4">
        <div className="text-center">
          <TextSkeleton width="w-32" />
        </div>
        <div className="text-center">
          <TextSkeleton width="w-48" />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { t, language } = useI18n();

  // Translations
  const title = t('auth.login.title');
  const loginLabel = t('auth.login.login');
  const passwordLabel = t('auth.login.password');
  const loginPlaceholder = t('auth.placeholders.login');
  const passwordPlaceholder = t('auth.placeholders.password');
  const submitButton = t('auth.login.submit');
  const loadingText = t('auth.login.loading');
  const forgotPassword = t('auth.login.forgotPassword');
  const noAccount = t('auth.login.noAccount');
  const signUpLink = t('auth.login.signUpLink');
  const loginRequired = t('auth.login.errors.loginRequired');
  const loginMinLength = t('auth.login.errors.loginMinLength');
  const passwordRequired = t('auth.login.errors.passwordRequired');
  const passwordMinLength = t('auth.login.errors.passwordMinLength');
  const userBanned = t('auth.errors.userBanned');
  const invalidCredentials = t('auth.login.errors.invalidCredentials');
  const successLogin = t('auth.login.success');
  const errorNotification = t('auth.login.error');

  return (
    <>
      <AuthCard title={title}>
        <Suspense fallback={<SignInLoading loginLabel={loginLabel} passwordLabel={passwordLabel} loginPlaceholder={loginPlaceholder} passwordPlaceholder={passwordPlaceholder} />}>
          <SignInForm
            registrationMode={'open'}
            serverLanguage={language}
            serverTranslations={{
              loginLabel,
              passwordLabel,
              loginPlaceholder,
              passwordPlaceholder,
              submitButton,
              loadingText,
              forgotPassword,
              noAccount,
              signUpLink,
              loginRequired,
              loginMinLength,
              passwordRequired,
              passwordMinLength,
              userBanned,
              invalidCredentials,
              successLogin,
              errorNotification,
            }}
          />
        </Suspense>
      </AuthCard>
      <LanguageSelector currentLanguage={language} />
    </>
  );
}
