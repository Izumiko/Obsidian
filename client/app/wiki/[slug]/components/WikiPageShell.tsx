'use client';

import { Suspense } from 'react';
import { useParams, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { API_BASE_URL } from '@/lib/api';
import { useI18n } from '@/app/hooks/useI18n';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import WikiPageClient from './WikiPageClient';

interface WikiPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    username: string;
  };
  updatedBy: {
    id: string;
    username: string;
  };
  parent?: {
    id: string;
    slug: string;
    title: string;
  };
  children: Array<{
    id: string;
    slug: string;
    title: string;
  }>;
}

function WikiPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse">
        <div className="h-8 bg-background rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-background rounded w-1/2"></div>
      </div>

      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-background rounded w-full"></div>
        <div className="h-4 bg-background rounded w-5/6"></div>
        <div className="h-4 bg-background rounded w-4/5"></div>
        <div className="h-4 bg-background rounded w-full"></div>
        <div className="h-4 bg-background rounded w-3/4"></div>
      </div>
    </div>
  );
}

export default function WikiPageShell() {
  const { t } = useI18n();
  const params = useParams();
  const pathname = usePathname();

  let slug = typeof params?.slug === 'string'
    ? params.slug
    : (Array.isArray(params?.slug) ? params.slug[0] : '');
  if (!slug || slug === '_placeholder') {
    slug = decodeURIComponent(pathname.split('/').filter(Boolean)[1] || '');
  }

  const { data, error, isLoading } = useSWR<WikiPage | null>(
    slug ? `${API_BASE_URL}/wiki/${slug}` : null,
    async (key: string) => {
      const res = await fetch(key, { cache: 'no-store' });
      if (!res.ok) return null;
      return res.json();
    }
  );

  return (
    <DashboardWrapper>
      <div className="max-w-4xl mx-auto px-4">
        {isLoading || !slug ? (
          <WikiPageSkeleton />
        ) : error || !data ? (
          <div className="py-8 text-center text-text-secondary">
            {t('wiki.notFound', 'Page not found')}
          </div>
        ) : (
          <>
            <div className="mb-8 mt-6">
              <h1 className="text-3xl font-bold text-text">{data.title}</h1>
              <p className="text-text-secondary mt-2">{t('wiki.pageDescription')}</p>
            </div>

            <Suspense fallback={<WikiPageSkeleton />}>
              <WikiPageClient page={data} />
            </Suspense>
          </>
        )}
      </div>
    </DashboardWrapper>
  );
}
