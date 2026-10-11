'use client';

import Link from 'next/link';
import Image from 'next/image';
import useSWR from 'swr';
import { API_BASE_URL } from '@/lib/api';
import { useI18n } from '@/app/hooks/useI18n';
import { LanguageSelector } from './LanguageSelector';
import { LanguageNotification } from './LanguageNotification';

interface SiteStats {
  totalUsers: number;
  totalTorrents: number;
  totalDownloads: number;
  totalUploadBytes: number;
}

interface Branding {
  brandingName?: string;
  showHomePageStats?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function SiteStatistics() {
  const { t } = useI18n();
  const usersText = t('common.users');
  const torrentsText = t('common.torrents');
  const downloadsText = t('common.downloads');
  const uploadedText = t('common.uploaded');
  const { data: stats, isLoading, error } = useSWR<SiteStats>(
    `${API_BASE_URL}/stats`,
    (k: string) => fetch(k).then((r) => r.json())
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8 max-w-4xl mx-auto px-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="text-center p-3 sm:p-4 bg-surface rounded-lg border border-border animate-pulse">
            <div className="h-6 sm:h-8 bg-text-secondary rounded mb-2"></div>
            <div className="h-3 sm:h-4 bg-text-secondary rounded w-12 sm:w-16 mx-auto"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center p-4 bg-error/10 border border-error/20 rounded-lg mb-8">
        <p className="text-error">Unable to load site statistics</p>
        <p className="text-sm text-text-secondary">API connection failed</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8 max-w-4xl mx-auto px-4">
      <div className="text-center p-3 sm:p-4 bg-surface rounded-lg border border-border">
        <div className="text-lg sm:text-2xl font-bold text-primary">{stats.totalUsers.toLocaleString()}</div>
        <div className="text-xs sm:text-sm text-text-secondary">{usersText}</div>
      </div>
      <div className="text-center p-3 sm:p-4 bg-surface rounded-lg border border-border">
        <div className="text-lg sm:text-2xl font-bold text-green">{stats.totalTorrents.toLocaleString()}</div>
        <div className="text-xs sm:text-sm text-text-secondary">{torrentsText}</div>
      </div>
      <div className="text-center p-3 sm:p-4 bg-surface rounded-lg border border-border">
        <div className="text-lg sm:text-2xl font-bold text-orange">{stats.totalDownloads.toLocaleString()}</div>
        <div className="text-xs sm:text-sm text-text-secondary">{downloadsText}</div>
      </div>
      <div className="text-center p-3 sm:p-4 bg-surface rounded-lg border border-border">
        <div className="text-lg sm:text-2xl font-bold text-yellow">{formatBytes(stats.totalUploadBytes)}</div>
        <div className="text-xs sm:text-sm text-text-secondary">{uploadedText}</div>
      </div>
    </div>
  );
}

export default function HomePageClient() {
  const { t, language } = useI18n();
  const { data: branding } = useSWR<Branding>(
    `${API_BASE_URL}/config/branding`,
    (k: string) => fetch(k).then((r) => r.json())
  );
  const brandingName = branding?.brandingName || 'Obsidian Tracker';
  const showHomePageStats = branding?.showHomePageStats ?? true;

  const subtitle = t('home.subtitle');
  const welcomeTitle = t('home.welcome.title');
  const welcomeDescription = t('home.welcome.description');
  const footerDescription = t('home.footer.description');
  const loginText = t('home.footer.login');
  const registerText = t('home.footer.register');
  const aboutText = t('home.footer.about');
  const statsText = t('home.footer.stats');
  const apiText = t('home.footer.api');

  const languageNotificationTranslations = {
    changed: t('language.notification.changed'),
    spanish: t('language.notification.spanish'),
    english: t('language.notification.english'),
    chinese: t('language.notification.chinese'),
  };

  return (
    <>
      <LanguageNotification
        language={language}
        translations={languageNotificationTranslations}
      />
      <div className="min-h-screen flex flex-col bg-background text-text">
        <LanguageSelector currentLanguage={language} className="absolute top-2 left-2 sm:hidden" />

        <LanguageSelector currentLanguage={language} className="hidden sm:block absolute bottom-4 left-4" />

        <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
        <div className="text-center mb-6 sm:mb-8">
          <Image
            src="/logo.png"
            alt="Obsidian logo"
            width={160}
            height={160}
            quality={100}
            priority
            sizes="(max-width: 640px) 140px, 160px"
            className="mx-auto mb-6 sm:mb-8 w-32 h-32 sm:w-40 sm:h-40"
            draggable={false}
          />
          <h1 className="text-4xl sm:text-5xl lg:text-6xl tracking-tighter mb-3 sm:mb-4">
            {(() => {
              const parts = brandingName.trim().split(/\s+/);
              if (parts.length >= 2) {
                const first = parts.slice(0, -1).join(' ');
                const last = parts[parts.length - 1];
                return (
                  <>
                    <span className="text-purple-500">{first} </span>
                    <span className="text-green">{last}</span>
                  </>
                );
              }
              return <span className="text-purple-500">{brandingName}</span>;
            })()}
          </h1>
          <p className="text-text-secondary text-base sm:text-lg px-4">
            {subtitle}
          </p>
        </div>

        {showHomePageStats && <SiteStatistics />}

        <div className="flex flex-col sm:flex-row gap-4 sm:space-x-6 mb-6 sm:mb-8 px-4">
          <Link
            href="/auth/signin"
            className="px-6 sm:px-8 py-3 bg-primary text-background rounded-lg hover:bg-primary-dark transition-colors font-medium text-base sm:text-lg text-center"
          >
            {loginText}
          </Link>
          <Link
            href="/auth/signup"
            className="px-6 sm:px-8 py-3 bg-surface border border-border text-text rounded-lg hover:bg-accent-background transition-colors font-medium text-base sm:text-lg text-center"
          >
            {registerText}
          </Link>
        </div>

        <div className="text-center text-text-secondary px-4 max-w-2xl mx-auto">
          <p className="mb-3 sm:mb-4 text-base sm:text-lg">
            {welcomeTitle}
          </p>
          <p className="text-sm sm:text-base">
            {welcomeDescription}
          </p>
        </div>
      </main>

      <footer className="text-center p-4 sm:p-8 bg-surface border-t border-border">
        <p className="text-text-secondary mb-4 text-sm sm:text-base px-4">
          {footerDescription}
        </p>
        <nav className="flex justify-center items-center space-x-4">
          <Link href="/about" className="text-text hover:text-primary transition-colors text-sm sm:text-base">
            {aboutText}
          </Link>
          <span className="text-border">|</span>
          <Link href="/stats" className="text-text hover:text-primary transition-colors text-sm sm:text-base">
            {statsText}
          </Link>
          <span className="text-border">|</span>
          <Link href="/api" className="text-text hover:text-primary transition-colors text-sm sm:text-base">
            {apiText}
          </Link>
        </nav>
      </footer>
    </div>
    </>
  );
}
