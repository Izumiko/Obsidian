'use client';

import { useParams, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { API_BASE_URL } from '@/lib/api';
import { useI18n } from '@/app/hooks/useI18n';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import PublicProfileContent from './PublicProfileContent';

interface PublicProfile {
  id: string;
  username: string;
  role: string;
  upload: string;
  download: string;
  ratio: string;
  createdAt: string;
  avatarUrl: string | null;
  error?: never;
  publicTorrents: {
    id: string;
    name: string;
    size: string;
    createdAt: string;
    category: string;
    seeders: number;
    leechers: number;
    completed: number;
  }[];
}

type ProfileResult = PublicProfile | { error: 'private' } | null;

export default function PublicProfileShell() {
  const { t } = useI18n();
  const params = useParams();
  const pathname = usePathname();

  let username = typeof params?.username === 'string'
    ? params.username
    : (Array.isArray(params?.username) ? params.username[0] : '');
  if (!username || username === '_placeholder') {
    username = decodeURIComponent(pathname.split('/').filter(Boolean)[1] || '');
  }

  const { data, error, isLoading } = useSWR<ProfileResult>(
    username ? `${API_BASE_URL}/user/${username}` : null,
    async (key: string) => {
      const res = await fetch(key, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (res.status === 403) return { error: 'private' };
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    }
  );

  return (
    <DashboardWrapper>
      <div className="container mx-auto px-4 py-8">
        {isLoading || !username ? (
          <div className="flex justify-center py-12">
            <div className="animate-pulse h-8 w-48 bg-surface-secondary rounded" />
          </div>
        ) : error || !data ? (
          <div className="bg-surface rounded-lg border border-border p-8 text-center">
            <h1 className="text-2xl font-bold text-text mb-4">
              {t('publicProfile.notFound', 'User not found')}
            </h1>
          </div>
        ) : data?.error === 'private' ? (
          <div className="bg-surface rounded-lg border border-border p-8 text-center">
            <h1 className="text-2xl font-bold text-text mb-4">
              {t('publicProfile.private.title')}
            </h1>
            <p className="text-text-secondary">
              {t('publicProfile.private.description')}
            </p>
          </div>
        ) : (
          <PublicProfileContent profile={data} />
        )}
      </div>
    </DashboardWrapper>
  );
}
