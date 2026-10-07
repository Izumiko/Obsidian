'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import UsersClient from './components/UsersClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function UsersSkeleton() {
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

export default function AdminUsersPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.users.title'),
    description: t('admin.users.description'),
    search: t('admin.users.search'),
    searching: t('admin.users.searching'),
    searchPlaceholder: t('admin.users.searchPlaceholder'),
    users: t('admin.users.users'),
    noUsers: t('admin.users.noUsers'),
    editUser: t('admin.users.editUser'),
    userDetails: t('admin.users.userDetails'),
    username: t('admin.users.username'),
    email: t('admin.users.email'),
    role: t('admin.users.role'),
    status: t('admin.users.status'),
    emailVerified: t('admin.users.emailVerified'),
    createdAt: t('admin.users.createdAt'),
    actions: t('admin.users.actions'),
    edit: t('admin.users.edit'),
    ban: t('admin.users.ban'),
    unban: t('admin.users.unban'),
    enable: t('admin.users.enable'),
    promote: t('admin.users.promote'),
    demote: t('admin.users.demote'),
    close: t('admin.users.close'),
    save: t('admin.users.save'),
    saving: t('admin.users.saving'),
    cancel: t('admin.users.cancel'),
    confirmBan: t('admin.users.confirmBan'),
    confirmUnban: t('admin.users.confirmUnban'),
    confirmPromote: t('admin.users.confirmPromote'),
    confirmDemote: t('admin.users.confirmDemote'),
    userBanned: t('admin.users.userBanned'),
    userUnbanned: t('admin.users.userUnbanned'),
    userPromoted: t('admin.users.userPromoted'),
    userDemoted: t('admin.users.userDemoted'),
    userUpdated: t('admin.users.userUpdated'),
    errorLoading: t('admin.users.errorLoading'),
    errorUpdating: t('admin.users.errorUpdating'),
    errorBanning: t('admin.users.errorBanning'),
    errorUnbanning: t('admin.users.errorUnbanning'),
    errorPromoting: t('admin.users.errorPromoting'),
    errorDemoting: t('admin.users.errorDemoting'),
    loading: t('admin.users.loading'),
    roles: {
      USER: t('admin.users.roles.USER'),
      MOD: t('admin.users.roles.MOD'),
      ADMIN: t('admin.users.roles.ADMIN'),
      OWNER: t('admin.users.roles.OWNER'),
      FOUNDER: t('admin.users.roles.FOUNDER'),
    },
    statuses: {
      ACTIVE: t('admin.users.statuses.ACTIVE'),
      BANNED: t('admin.users.statuses.BANNED'),
      DISABLED: t('admin.users.statuses.DISABLED'),
    },
    transferFounder: t('admin.users.transferFounder'),
    founderRoleWarning: t('admin.users.founderRoleWarning'),
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<UsersSkeleton />}> 
        <UsersClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
