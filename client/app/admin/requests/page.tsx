'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '../components/AdminDashboardWrapper';
import RequestClient from './RequestClient';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function RequestSkeleton() {
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

export default function AdminRequestsPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.requests.title'),
    description: t('admin.requests.description'),
    list: t('admin.requests.list'),
    titleField: t('admin.requests.titleField'),
    descriptionField: t('admin.requests.description'),
    category: t('admin.requests.category'),
    status: t('admin.requests.status'),
    createdBy: t('admin.requests.createdBy'),
    filledBy: t('admin.requests.filledBy'),
    filledTorrent: t('admin.requests.filledTorrent'),
    createdAt: t('admin.requests.createdAt'),
    updatedAt: t('admin.requests.updatedAt'),
    open: t('admin.requests.open'),
    filled: t('admin.requests.filled'),
    closed: t('admin.requests.closed'),
    rejected: t('admin.requests.rejected'),
    close: t('admin.requests.close'),
    reject: t('admin.requests.reject'),
    view: t('admin.requests.view'),
    reason: t('admin.requests.reason'),
    reasonOptional: t('admin.requests.reasonOptional'),
    closeRequest: t('admin.requests.closeRequest'),
    rejectRequest: t('admin.requests.rejectRequest'),
    viewRequest: t('admin.requests.viewRequest'),
    cancel: t('admin.requests.cancel'),
    confirmClose: t('admin.requests.confirmClose'),
    confirmReject: t('admin.requests.confirmReject'),
    noRequests: t('admin.requests.noRequests'),
    closedSuccess: t('admin.requests.closedSuccess'),
    rejectedSuccess: t('admin.requests.rejectedSuccess'),
    errorLoading: t('admin.requests.errorLoading'),
    errorClosing: t('admin.requests.errorClosing'),
    errorRejecting: t('admin.requests.errorRejecting'),
    filterBy: t('admin.requests.filterBy'),
    allRequests: t('admin.requests.allRequests'),
    openRequests: t('admin.requests.openRequests'),
    filledRequests: t('admin.requests.filledRequests'),
    closedRequests: t('admin.requests.closedRequests'),
    rejectedRequests: t('admin.requests.rejectedRequests'),
    searchBy: t('admin.requests.searchBy'),
    searchPlaceholder: t('admin.requests.searchPlaceholder'),
    requestDetails: t('admin.requests.requestDetails'),
    backToList: t('admin.requests.backToList'),
    requestNotFound: t('admin.requests.requestNotFound'),
    loadingRequest: t('admin.requests.loadingRequest'),
    comments: t('admin.requests.comments'),
    noComments: t('admin.requests.noComments'),
    addComment: t('admin.requests.addComment'),
    commentPlaceholder: t('admin.requests.commentPlaceholder'),
    postComment: t('admin.requests.postComment'),
    commentPosted: t('admin.requests.commentPosted'),
    errorPostingComment: t('admin.requests.errorPostingComment'),
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<RequestSkeleton />}> 
        <RequestClient translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}
