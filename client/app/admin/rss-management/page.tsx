'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import RssManagementClient from './RssManagementClient';
import { useI18n } from '@/app/hooks/useI18n';

export default function RSSManagementPage() {
  const { t } = useI18n();

  return (
    <AdminDashboardWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-text">
            {t('admin.rssManagement.title')}
          </h1>
          <p className="text-text-secondary mt-2">
            {t('admin.rssManagement.description')}
          </p>
        </div>

        <Suspense fallback={
          <div className="bg-surface border border-border rounded-lg p-6">
            <div className="text-center text-text-secondary py-12">
              <div className="text-4xl mb-4">📡</div>
              <h3 className="text-lg font-medium mb-2">Loading...</h3>
              <p className="text-sm">Please wait while we load the RSS management system.</p>
            </div>
          </div>
        }>
          <RssManagementClient />
        </Suspense>
      </div>
    </AdminDashboardWrapper>
  );
}
