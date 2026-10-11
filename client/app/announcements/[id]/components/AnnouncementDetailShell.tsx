'use client';

import { Suspense } from 'react';
import { useParams, usePathname } from 'next/navigation';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import { useI18n } from '@/app/hooks/useI18n';
import AnnouncementDetailClient from './AnnouncementDetailClient';

function AnnouncementDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-surface rounded-lg border border-border p-8">
        {/* Header Skeleton */}
        <div className="mb-6">
          <div className="h-8 w-3/4 bg-text-secondary rounded animate-pulse mb-2"></div>
          <div className="h-4 w-1/2 bg-text-secondary rounded animate-pulse"></div>
        </div>
        
        {/* Content Skeleton */}
        <div className="space-y-4 mb-6">
          <div className="h-4 bg-text-secondary rounded w-full"></div>
          <div className="h-4 bg-text-secondary rounded w-full"></div>
          <div className="h-4 bg-text-secondary rounded w-3/4"></div>
          <div className="h-4 bg-text-secondary rounded w-full"></div>
          <div className="h-4 bg-text-secondary rounded w-2/3"></div>
        </div>
        
        {/* Footer Skeleton */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center space-x-4">
            <div className="h-3 w-32 bg-text-secondary rounded animate-pulse"></div>
            <div className="h-3 w-24 bg-text-secondary rounded animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementDetailShell() {
  const params = useParams();
  const pathname = usePathname();
  const { t } = useI18n();

  let id = typeof params?.id === 'string' ? params.id : (Array.isArray(params?.id) ? params.id[0] : '');
  if (!id || id === '_placeholder') {
    const seg = pathname.split('/').filter(Boolean);
    id = seg[1] || '';
  }
  if (!id) return null;

  const translations = {
    title: t('sidebar.nav.announcements'),
    backToAnnouncements: t('dashboard.backToAnnouncements'),
    createdBy: t('dashboard.createdBy'),
    createdAt: t('dashboard.createdAt'),
    updatedAt: t('dashboard.updatedAt'),
    notFound: t('dashboard.notFound'),
    error: t('dashboard.error'),
    loading: t('dashboard.loading'),
  };

  return (
    <DashboardWrapper>
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8 mt-6">
          <h1 className="text-3xl font-bold text-text">{translations.title}</h1>
        </div>

        <Suspense fallback={<AnnouncementDetailSkeleton />}>
          <AnnouncementDetailClient
            announcementId={id}
            translations={translations}
          />
        </Suspense>
      </div>
    </DashboardWrapper>
  );
}
