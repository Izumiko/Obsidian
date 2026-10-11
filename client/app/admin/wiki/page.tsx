'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import WikiClient from './WikiClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function WikiSkeleton() {
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

export default function AdminWikiPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.wiki.title'),
    description: t('admin.wiki.description'),
    addNew: t('admin.wiki.addNew'),
    addWikiPage: t('admin.wiki.addWikiPage'),
    editWikiPage: t('admin.wiki.editWikiPage'),
    list: t('admin.wiki.list'),
    slug: t('admin.wiki.slug'),
    titleField: t('admin.wiki.titleField'),
    content: t('admin.wiki.content'),
    parentPage: t('admin.wiki.parentPage'),
    noParent: t('admin.wiki.noParent'),
    locked: t('admin.wiki.locked'),
    visible: t('admin.wiki.visible'),
    createdBy: t('admin.wiki.createdBy'),
    updatedBy: t('admin.wiki.updatedBy'),
    createdAt: t('admin.wiki.createdAt'),
    updatedAt: t('admin.wiki.updatedAt'),
    create: t('admin.wiki.create'),
    update: t('admin.wiki.update'),
    edit: t('admin.wiki.edit'),
    delete: t('admin.wiki.delete'),
    lock: t('admin.wiki.lock'),
    unlock: t('admin.wiki.unlock'),
    show: t('admin.wiki.show'),
    hide: t('admin.wiki.hide'),
    cancel: t('admin.wiki.cancel'),
    slugRequired: t('admin.wiki.slugRequired'),
    titleRequired: t('admin.wiki.titleRequired'),
    contentRequired: t('admin.wiki.contentRequired'),
    confirmDelete: t('admin.wiki.confirmDelete'),
    noWikiPages: t('admin.wiki.noWikiPages'),
    created: t('admin.wiki.created'),
    updated: t('admin.wiki.updated'),
    deleted: t('admin.wiki.deleted'),
    lockedSuccess: t('admin.wiki.lockedSuccess'),
    unlockedSuccess: t('admin.wiki.unlockedSuccess'),
    shownSuccess: t('admin.wiki.shownSuccess'),
    hiddenSuccess: t('admin.wiki.hiddenSuccess'),
    errorLoading: t('admin.wiki.errorLoading'),
    errorCreating: t('admin.wiki.errorCreating'),
    errorUpdating: t('admin.wiki.errorUpdating'),
    errorDeleting: t('admin.wiki.errorDeleting'),
    errorLocking: t('admin.wiki.errorLocking'),
    errorUnlocking: t('admin.wiki.errorUnlocking'),
    errorShowing: t('admin.wiki.errorShowing'),
    errorHiding: t('admin.wiki.errorHiding'),
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<WikiSkeleton />}> 
        <WikiClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
