'use client';

/**
 * Register page component - Optimized for maximum performance
 * Client Component with client-side translations
 * Minimal client-side JavaScript for better performance
 */

import { Suspense, useEffect, useState } from 'react';
import AuthCard from '../shared/AuthCard';
import { SignUpForm } from './components/SignUpForm';
import { API_BASE_URL } from '@/lib/api';
import { FormFieldSkeleton, ButtonSkeleton, TextSkeleton } from '../../components/ui/Skeleton';
import { LanguageSelector } from '../../components/LanguageSelector';
import { useI18n } from '../../hooks/useI18n';

// Enhanced loading component with theme-consistent styling
function SignUpLoading({ language }: { language: string }) {
  const { t } = useI18n(language);
  return (
    <div className="space-y-6">
      {/* Form fields skeleton */}
      <div className="space-y-4">
        <FormFieldSkeleton label={t('auth.register.username')} placeholder={t('auth.placeholders.username')} />
        <FormFieldSkeleton label={t('auth.register.email')} placeholder={t('auth.placeholders.email')} />
        <FormFieldSkeleton label={t('auth.register.password')} placeholder={t('auth.placeholders.password')} />
        <FormFieldSkeleton label={t('auth.register.confirmPassword')} placeholder={t('auth.placeholders.confirmPassword')} />
        <ButtonSkeleton />
      </div>

      {/* Links skeleton */}
      <div className="space-y-4">
        <div className="text-center">
          <TextSkeleton width="w-48" />
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const { t, language } = useI18n();
  const [registrationMode, setRegistrationMode] = useState('OPEN');

  useEffect(() => {
    let cancelled = false;
    const loadRegistrationMode = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/config/registration-mode`);
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json();
          setRegistrationMode(data.registrationMode || 'OPEN');
        } else {
          console.error('Failed to fetch registration mode:', response.status);
        }
      } catch (error) {
        console.error('Error fetching registration mode:', error);
      }
    };
    loadRegistrationMode();
    return () => { cancelled = true; };
  }, []);

  // Check authentication server-side
  // const session = await auth();
  
  // Redirect authenticated users to dashboard
  // if (session) {
  //   redirect('/dashboard');
  // }

  // Client-side translations with debug logging
  const title = t('auth.register.title');
  const usernameLabel = t('auth.register.username');
  const emailLabel = t('auth.register.email');
  const passwordLabel = t('auth.register.password');
  const confirmPasswordLabel = t('auth.register.confirmPassword');
  const submitButton = t('auth.register.submit');
  // Placeholders & loading
  const usernamePlaceholder = t('auth.placeholders.username');
  const emailPlaceholder = t('auth.placeholders.email');
  const passwordPlaceholder = t('auth.placeholders.password');
  const confirmPasswordPlaceholder = t('auth.placeholders.confirmPassword');
  const registerLoading = t('auth.register.loading');
  const hasAccount = t('auth.register.hasAccount');
  const loginLink = t('auth.register.login');
  
  // Error messages
  const usernameError = t('auth.register.errors.username');
  const emailError = t('auth.register.errors.email');
  const passwordRequirementsError = t('auth.register.errors.passwordRequirements');
  const passwordMatchError = t('auth.register.errors.passwordMatch');
  const invalidCredentialsError = t('auth.register.errors.invalidCredentials');
  const successRegister = t('auth.notification.successRegister');
  const errorNotification = t('auth.notification.error');
  const inviteOnlyTitle = t('auth.register.inviteOnly.title');
  const inviteOnlyMessage = t('auth.register.inviteOnly.message');
  
  // Registration closed messages
  const registrationClosedTitle = t('auth.register.registrationClosed');
  const registrationClosedMessage = t('auth.register.registrationClosedMessage');
  const registrationClosedDescription = t('auth.register.registrationClosedDescription');
  const goToLogin = t('auth.register.goToLogin');
  const alreadyHaveAccount = t('auth.register.alreadyHaveAccount');
  const signInHere = t('auth.register.signInHere');
  
  // Password strength translations
  const securityRecommendations = t('auth.register.securityRecommendations');
  const weak = t('auth.register.passwordStrength.weak');
  const fair = t('auth.register.passwordStrength.fair');
  const good = t('auth.register.passwordStrength.good');
  const strong = t('auth.register.passwordStrength.strong');
  const minLength = t('auth.register.passwordRequirements.minLength');
  const uppercase = t('auth.register.passwordRequirements.uppercase');
  const lowercase = t('auth.register.passwordRequirements.lowercase');
  const number = t('auth.register.passwordRequirements.number');
  const special = t('auth.register.passwordRequirements.special');

  // Debug logging
  console.log('🎯 SignUp Page Server Translations:', {
    language,
    title,
    usernameLabel,
    emailLabel,
    passwordLabel,
    confirmPasswordLabel,
    submitButton,
    hasAccount,
    loginLink,
    registrationMode
  });

  return (
    <>
      <AuthCard title={title}>
        {registrationMode === 'OPEN' && (
          <Suspense fallback={<SignUpLoading language={language} />}>
            <SignUpForm 
              registrationMode={registrationMode}
              language={language}
              serverTranslations={{
                title,
                usernameLabel,
                emailLabel,
                passwordLabel,
                confirmPasswordLabel,
                submitButton,
                hasAccount,
                loginLink,
                usernameError,
                emailError,
                passwordRequirementsError,
                passwordMatchError,
                invalidCredentialsError,
                successRegister,
                errorNotification,
                inviteOnlyTitle,
                inviteOnlyMessage,
                // Placeholders & loading
                usernamePlaceholder,
                emailPlaceholder,
                passwordPlaceholder,
                confirmPasswordPlaceholder,
                registerLoading,
                registrationClosedTitle,
                registrationClosedMessage,
                registrationClosedDescription,
                goToLogin,
                alreadyHaveAccount,
                signInHere,
                // Password strength translations
                securityRecommendations,
                weak,
                fair,
                good,
                strong,
                minLength,
                uppercase,
                lowercase,
                number,
                special
              }}
            />
          </Suspense>
        )}
        {registrationMode === 'CLOSED' && (
          <div className="space-y-4">
            <div className="p-4 rounded border border-error bg-error/10">
              <div className="font-semibold mb-1 text-error">{registrationClosedTitle}</div>
              <div className="text-sm text-text-secondary">{registrationClosedMessage}</div>
            </div>
          </div>
        )}
        {registrationMode === 'INVITE' && (
          <div className="space-y-4">
            <div className="p-4 rounded border border-primary bg-surface">
              <div className="font-semibold mb-1 text-text">{inviteOnlyTitle}</div>
              <div className="text-sm text-text-secondary">{inviteOnlyMessage}</div>
            </div>
          </div>
        )}
      </AuthCard>
      
      {/* Language Selector - Bottom Left Corner */}
      <LanguageSelector currentLanguage={language} />
    </>
  );
}
