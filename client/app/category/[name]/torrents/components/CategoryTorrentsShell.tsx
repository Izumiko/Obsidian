'use client';

import { Suspense } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import CategoryTorrentsClient from '@/app/category/[name]/torrents/components/CategoryTorrentsClient';
import { useI18n } from '@/app/hooks/useI18n';

function CategoryTorrentsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Breadcrumb Skeleton */}
      <div className="flex items-center space-x-2">
        <div className="h-4 w-16 bg-text-secondary/20 rounded animate-pulse"></div>
        <div className="h-4 w-4 bg-text-secondary/20 rounded animate-pulse"></div>
        <div className="h-4 w-24 bg-text-secondary/20 rounded animate-pulse"></div>
      </div>

      {/* Header Skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 bg-text-secondary/20 rounded animate-pulse"></div>
        <div className="h-4 w-64 bg-text-secondary/20 rounded animate-pulse"></div>
      </div>

      {/* Filters Skeleton */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="flex flex-wrap gap-4">
          <div className="h-10 w-32 bg-text-secondary/20 rounded animate-pulse"></div>
          <div className="h-10 w-24 bg-text-secondary/20 rounded animate-pulse"></div>
          <div className="h-10 w-28 bg-text-secondary/20 rounded animate-pulse"></div>
        </div>
      </div>

      {/* Torrents List Skeleton */}
      <div className="space-y-4">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bg-surface rounded-lg border border-border p-6 animate-pulse">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <div className="h-6 w-3/4 bg-text-secondary/20 rounded"></div>
                <div className="h-4 w-1/2 bg-text-secondary/20 rounded"></div>
                <div className="flex items-center space-x-4">
                  <div className="h-4 w-16 bg-text-secondary/20 rounded"></div>
                  <div className="h-4 w-20 bg-text-secondary/20 rounded"></div>
                  <div className="h-4 w-24 bg-text-secondary/20 rounded"></div>
                </div>
              </div>
              <div className="ml-4 space-y-2">
                <div className="h-8 w-20 bg-text-secondary/20 rounded"></div>
                <div className="h-6 w-16 bg-text-secondary/20 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Skeleton */}
      <div className="flex justify-center">
        <div className="flex space-x-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 w-10 bg-text-secondary/20 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CategoryTorrentsShell() {
  const { t } = useI18n();
  const params = useParams();
  const pathname = usePathname();
  const searchParamsHook = useSearchParams();

  let name = typeof params?.name === 'string' ? params.name : (Array.isArray(params?.name) ? params.name[0] : '');
  if (!name || name === '_placeholder') {
    name = pathname.split('/').filter(Boolean)[1] || '';
  }
  name = decodeURIComponent(name);

  const searchParamsObj = {
    page: searchParamsHook.get('page') || undefined,
    source: searchParamsHook.get('source') || undefined,
    sort: searchParamsHook.get('sort') || undefined,
  };

  const translations = {
    title: t('categoryTorrents.title'),
    description: t('categoryTorrents.description'),
    breadcrumbHome: t('sidebar.nav.home'),
    breadcrumbCategories: t('sidebar.nav.categories'),
    noTorrents: t('categoryTorrents.noTorrents'),
    loading: t('categoryTorrents.loading'),
    filters: {
      allSources: t('categoryTorrents.filters.allSources'),
      sortBy: t('categoryTorrents.filters.sortBy'),
      newest: t('categoryTorrents.filters.newest'),
      oldest: t('categoryTorrents.filters.oldest'),
      mostSeeded: t('categoryTorrents.filters.mostSeeded'),
      leastSeeded: t('categoryTorrents.filters.leastSeeded'),
      largest: t('categoryTorrents.filters.largest'),
      smallest: t('categoryTorrents.filters.smallest'),
    },
    torrent: {
      title: t('categoryTorrents.torrent.title'),
      seeders: t('categoryTorrents.torrent.seeders'),
      leechers: t('categoryTorrents.torrent.leechers'),
      completed: t('categoryTorrents.torrent.completed'),
      uploaded: t('categoryTorrents.torrent.uploaded'),
      by: t('categoryTorrents.torrent.by'),
      size: t('categoryTorrents.torrent.size'),
      download: t('categoryTorrents.torrent.download'),
      uploader: t('categoryTorrents.torrent.uploader'),
      category: t('categoryTorrents.torrent.category'),
    },
    pagination: {
      previous: t('categoryTorrents.pagination.previous'),
      next: t('categoryTorrents.pagination.next'),
      page: t('categoryTorrents.pagination.page'),
      of: t('categoryTorrents.pagination.of'),
    },
  };

  return (
    <DashboardWrapper>
      <div className="max-w-screen-2xl mx-auto px-4">
        <Suspense fallback={<CategoryTorrentsSkeleton />}>
          <CategoryTorrentsClient
            categoryName={name}
            searchParams={searchParamsObj}
            translations={translations}
          />
        </Suspense>
      </div>
    </DashboardWrapper>
  );
}
