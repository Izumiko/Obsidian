'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardWrapper from '../dashboard/components/DashboardWrapper';
import SearchClient from './components/SearchClient';
import { useI18n } from '../hooks/useI18n';

function SearchSkeleton() {
  return (
    <div className="space-y-6 mt-6">
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
        </div>
      </div>

      {/* Results Skeleton */}
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
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

function SearchResults() {
  const { t } = useI18n();
  const sp = useSearchParams();

  const searchParams = {
    tag: sp.get('tag') ?? undefined,
    q: sp.get('q') ?? undefined,
    page: sp.get('page') ?? undefined,
    sort: sp.get('sort') ?? undefined,
  };

  const translations = {
    title: t('search.title'),
    description: t('search.description'),
    noResults: t('search.noResults'),
    loading: t('search.loading'),
    filters: {
      sortBy: t('search.filters.sortBy'),
      newest: t('search.filters.newest'),
      oldest: t('search.filters.oldest'),
      mostSeeded: t('search.filters.mostSeeded'),
      leastSeeded: t('search.filters.leastSeeded'),
      largest: t('search.filters.largest'),
      smallest: t('search.filters.smallest'),
    },
    torrent: {
      title: t('search.torrent.title'),
      seeders: t('search.torrent.seeders'),
      leechers: t('search.torrent.leechers'),
      completed: t('search.torrent.completed'),
      uploaded: t('search.torrent.uploaded'),
      by: t('search.torrent.by'),
      size: t('search.torrent.size'),
      download: t('search.torrent.download'),
      uploader: t('search.torrent.uploader'),
      category: t('search.torrent.category'),
    },
    pagination: {
      previous: t('search.pagination.previous'),
      next: t('search.pagination.next'),
      page: t('search.pagination.page'),
      of: t('search.pagination.of'),
    },
  };

  return (
    <DashboardWrapper>
      <div className="max-w-screen-2xl mx-auto px-4">
        <Suspense fallback={<SearchSkeleton />}>
          <SearchClient 
            searchParams={searchParams}
            translations={translations}
          />
        </Suspense>
      </div>
    </DashboardWrapper>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchResults />
    </Suspense>
  );
}
