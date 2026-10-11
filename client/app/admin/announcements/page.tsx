'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import AnnouncementsClient from './AnnouncementsClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function AnnouncementsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="mb-8 animate-pulse">
        <div className="h-8 bg-surface-light rounded mb-2" />
        <div className="h-4 bg-surface-light rounded" />
      </div>
      <div className="space-y-4">
        <div className="h-6 bg-surface-light rounded w-40" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-surface-light rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminAnnouncementsPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.announcements.title'),
    description: t('admin.announcements.description'),
    addNew: t('admin.announcements.addNew'),
    addAnnouncement: t('admin.announcements.addAnnouncement'),
    editAnnouncement: t('admin.announcements.editAnnouncement'),
    list: t('admin.announcements.list'),
    titleField: t('admin.announcements.titleField'),
    body: t('admin.announcements.body'),
    pinned: t('admin.announcements.pinned'),
    visible: t('admin.announcements.visible'),
    createdBy: t('admin.announcements.createdBy'),
    createdAt: t('admin.announcements.createdAt'),
    updatedAt: t('admin.announcements.updatedAt'),
    create: t('admin.announcements.create'),
    update: t('admin.announcements.update'),
    edit: t('admin.announcements.edit'),
    delete: t('admin.announcements.delete'),
    pin: t('admin.announcements.pin'),
    unpin: t('admin.announcements.unpin'),
    show: t('admin.announcements.show'),
    hide: t('admin.announcements.hide'),
    cancel: t('admin.announcements.cancel'),
    titleRequired: t('admin.announcements.titleRequired'),
    bodyRequired: t('admin.announcements.bodyRequired'),
    confirmDelete: t('admin.announcements.confirmDelete'),
    noAnnouncements: t('admin.announcements.noAnnouncements'),
    created: t('admin.announcements.created'),
    updated: t('admin.announcements.updated'),
    deleted: t('admin.announcements.deleted'),
    pinnedSuccess: t('admin.announcements.pinnedSuccess'),
    unpinnedSuccess: t('admin.announcements.unpinnedSuccess'),
    shownSuccess: t('admin.announcements.shownSuccess'),
    hiddenSuccess: t('admin.announcements.hiddenSuccess'),
    errorLoading: t('admin.announcements.errorLoading'),
    errorCreating: t('admin.announcements.errorCreating'),
    errorUpdating: t('admin.announcements.errorUpdating'),
    errorDeleting: t('admin.announcements.errorDeleting'),
    errorPinning: t('admin.announcements.errorPinning'),
    errorUnpinning: t('admin.announcements.errorUnpinning'),
    errorShowing: t('admin.announcements.errorShowing'),
    errorHiding: t('admin.announcements.errorHiding'),
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<AnnouncementsSkeleton />}> 
        <AnnouncementsClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
