'use client';

import { Suspense } from 'react';
import DashboardWrapper from './components/DashboardWrapper';
import DashboardClient from './components/DashboardClient';
import { useI18n } from '../hooks/useI18n';

export default function DashboardPage() {
  const { t } = useI18n();

  const translations = {
    latestTorrents: t('dashboard.latestTorrents'),
    pinnedAnnouncements: t('dashboard.pinnedAnnouncements'),
    viewAll: t('dashboard.viewAll'),
    noTorrents: t('dashboard.noTorrents'),
    noAnnouncements: t('dashboard.noAnnouncements'),
    title: t('dashboard.title'),
    size: t('dashboard.size'),
    uploader: t('dashboard.uploader'),
    category: t('dashboard.category'),
    seeders: t('dashboard.seeders'),
    leechers: t('dashboard.leechers'),
    completed: t('dashboard.completed'),
    uploaded: t('dashboard.uploaded'),
    by: t('dashboard.by'),
    previous: t('dashboard.previous'),
    next: t('dashboard.next'),
    page: t('dashboard.page'),
    of: t('dashboard.of'),
  };

  return (
    <DashboardWrapper>
      <div className="max-w-screen-2xl mx-auto px-4">
        <Suspense fallback={
          <div className="space-y-6">
            {/* Pinned Announcements Skeleton */}
            <div className="bg-surface rounded-lg border border-border p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-text">{translations.pinnedAnnouncements}</h2>
                <div className="h-8 w-20 bg-text-secondary rounded animate-pulse"></div>
              </div>
              <div className="space-y-3">
                <div className="p-4 border border-border rounded-lg animate-pulse">
                  <div className="h-4 bg-text-secondary rounded w-2/3 mb-2"></div>
                  <div className="h-3 bg-text-secondary rounded w-1/3"></div>
                </div>
              </div>
            </div>

            {/* Latest Torrents Skeleton */}
            <div className="bg-surface rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-text">{translations.latestTorrents}</h2>
                <div className="h-8 w-20 bg-text-secondary rounded animate-pulse"></div>
              </div>
              <div className="space-y-3">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="p-4 border border-border rounded-lg animate-pulse">
                    <div className="h-4 bg-text-secondary rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-text-secondary rounded w-1/2 mb-2"></div>
                    <div className="flex space-x-4">
                      <div className="h-3 bg-text-secondary rounded w-16"></div>
                      <div className="h-3 bg-text-secondary rounded w-20"></div>
                      <div className="h-3 bg-text-secondary rounded w-12"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }>
          <DashboardClient translations={translations} />
        </Suspense>
      </div>
    </DashboardWrapper>
  );
}


