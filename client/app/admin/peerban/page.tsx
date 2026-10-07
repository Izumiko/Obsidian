'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import PeerBanClient from './PeerBanClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function PeerBanSkeleton() {
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

export default function AdminPeerBanPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.peerban.title'),
    description: t('admin.peerban.description'),
    addNew: t('admin.peerban.addNew'),
    addPeerBan: t('admin.peerban.addPeerBan'),
    editPeerBan: t('admin.peerban.editPeerBan'),
    list: t('admin.peerban.list'),
    userId: t('admin.peerban.userId'),
    passkey: t('admin.peerban.passkey'),
    peerId: t('admin.peerban.peerId'),
    ip: t('admin.peerban.ip'),
    reason: t('admin.peerban.reason'),
    expiresAt: t('admin.peerban.expiresAt'),
    noExpiration: t('admin.peerban.noExpiration'),
    bannedBy: t('admin.peerban.bannedBy'),
    createdAt: t('admin.peerban.createdAt'),
    status: t('admin.peerban.status'),
    active: t('admin.peerban.active'),
    expired: t('admin.peerban.expired'),
    permanent: t('admin.peerban.permanent'),
    create: t('admin.peerban.create'),
    update: t('admin.peerban.update'),
    edit: t('admin.peerban.edit'),
    delete: t('admin.peerban.delete'),
    remove: t('admin.peerban.remove'),
    cancel: t('admin.peerban.cancel'),
    reasonRequired: t('admin.peerban.reasonRequired'),
    banTypeRequired: t('admin.peerban.banTypeRequired'),
    confirmDelete: t('admin.peerban.confirmDelete'),
    noPeerBans: t('admin.peerban.noPeerBans'),
    created: t('admin.peerban.created'),
    removed: t('admin.peerban.removed'),
    errorLoading: t('admin.peerban.errorLoading'),
    errorCreating: t('admin.peerban.errorCreating'),
    errorRemoving: t('admin.peerban.errorRemoving'),
    filterBy: t('admin.peerban.filterBy'),
    allBans: t('admin.peerban.allBans'),
    activeBans: t('admin.peerban.activeBans'),
    expiredBans: t('admin.peerban.expiredBans'),
    searchBy: t('admin.peerban.searchBy'),
    searchPlaceholder: t('admin.peerban.searchPlaceholder'),
    banTypes: {
      userId: t('admin.peerban.banTypes.userId'),
      passkey: t('admin.peerban.banTypes.passkey'),
      peerId: t('admin.peerban.banTypes.peerId'),
      ip: t('admin.peerban.banTypes.ip'),
    },
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<PeerBanSkeleton />}> 
        <PeerBanClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
