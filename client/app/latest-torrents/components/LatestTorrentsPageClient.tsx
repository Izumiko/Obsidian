'use client';

import { Suspense } from 'react';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import LatestTorrentsClient from './LatestTorrentsClient';
import { useI18n } from '@/app/hooks/useI18n';

export default function LatestTorrentsPageClient() {
  const { t } = useI18n();

  const translations = {
    title: t('latestTorrents.title'),
    subtitle: t('latestTorrents.subtitle'),
    noTorrents: t('latestTorrents.noTorrents'),
    size: t('latestTorrents.size'),
    uploader: t('latestTorrents.uploader'),
    category: t('latestTorrents.category'),
    seeders: t('latestTorrents.seeders'),
    leechers: t('latestTorrents.leechers'),
    completed: t('latestTorrents.completed'),
    uploaded: t('latestTorrents.uploaded'),
    previous: t('latestTorrents.previous'),
    next: t('latestTorrents.next'),
    page: t('latestTorrents.page'),
    of: t('latestTorrents.of'),
    torrent: {
      title: t('latestTorrents.torrent.title'),
      size: t('latestTorrents.torrent.size'),
      category: t('latestTorrents.torrent.category'),
      date: t('latestTorrents.torrent.date'),
      seeders: t('latestTorrents.torrent.seeders'),
      leechers: t('latestTorrents.torrent.leechers'),
      completed: t('latestTorrents.torrent.completed'),
    }
  };

  return (
    <DashboardWrapper>
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-text mb-2">
            {translations.title}
          </h1>
          <p className="text-text-secondary">
            {translations.subtitle}
          </p>
        </div>

        <Suspense fallback={
          <div className="bg-surface rounded-lg border border-border p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-text-secondary/10 rounded w-1/3 mb-4"></div>
              <div className="space-y-3">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-16 bg-text-secondary/10 rounded"></div>
                ))}
              </div>
            </div>
          </div>
        }>
          <LatestTorrentsClient translations={translations} />
        </Suspense>
      </div>
    </DashboardWrapper>
  );
}
