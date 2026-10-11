'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import CategoriesClient from './CategoriesClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function CategoriesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="mb-8 animate-pulse">
        <div className="h-8 bg-surface-light rounded mb-2" />
        <div className="h-4 bg-surface-light rounded" />
      </div>
      <div className="space-y-4">
        <div className="h-6 bg-surface-light rounded w-40" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-surface-light rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminCategoriesPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.categories.title'),
    description: t('admin.categories.description'),
    addNew: t('admin.categories.addNew'),
    addCategory: t('admin.categories.addCategory'),
    editCategory: t('admin.categories.editCategory'),
    list: t('admin.categories.list'),
    name: t('admin.categories.name'),
    descriptionField: t('admin.categories.description'),
    icon: t('admin.categories.icon'),
    order: t('admin.categories.order'),
    parentCategory: t('admin.categories.parentCategory'),
    noParent: t('admin.categories.noParent'),
    torrents: t('admin.categories.torrents'),
    requests: t('admin.categories.requests'),
    create: t('admin.categories.create'),
    update: t('admin.categories.update'),
    edit: t('admin.categories.edit'),
    delete: t('admin.categories.delete'),
    cancel: t('admin.categories.cancel'),
    nameRequired: t('admin.categories.nameRequired'),
    confirmDelete: t('admin.categories.confirmDelete'),
    noCategories: t('admin.categories.noCategories'),
    created: t('admin.categories.created'),
    updated: t('admin.categories.updated'),
    deleted: t('admin.categories.deleted'),
    errorLoading: t('admin.categories.errorLoading'),
    errorCreating: t('admin.categories.errorCreating'),
    errorUpdating: t('admin.categories.errorUpdating'),
    errorDeleting: t('admin.categories.errorDeleting'),
    dragToReorder: t('admin.categories.dragToReorder'),
    reorderSuccess: t('admin.categories.reorderSuccess'),
    reorderError: t('admin.categories.reorderError'),
    moveToCategory: t('admin.categories.moveToCategory'),
    moveToMain: t('admin.categories.moveToMain'),
    moveSuccess: t('admin.categories.moveSuccess'),
    moveError: t('admin.categories.moveError'),
    dropZone: t('admin.categories.dropZone'),
    dropHereToMove: t('admin.categories.dropHereToMove'),
    errorHasSubcategories: t('admin.categories.errorHasSubcategories'),
    errorSubcategoryParent: t('admin.categories.errorSubcategoryParent'),
    errorCircularReference: t('admin.categories.errorCircularReference'),
    errorSelfParent: t('admin.categories.errorSelfParent'),
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<CategoriesSkeleton />}> 
        <CategoriesClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
