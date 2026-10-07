'use client';

import { Suspense } from 'react';
import AdminDashboardWrapper from '@/app/admin/components/AdminDashboardWrapper';
import SettingsContent from './components/SettingsContent';
import { LanguageSelector } from '@/app/components/LanguageSelector';
import { useI18n } from '@/app/hooks/useI18n';

function SettingsSkeleton() {
  return (
    <div className="max-w-7xl mx-auto py-10">
      <div className="mb-8 animate-pulse">
        <div className="h-8 bg-surface-light rounded mb-2" />
        <div className="h-4 bg-surface-light rounded" />
      </div>
      <div className="flex gap-6">
        <div className="w-80 flex-shrink-0">
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border bg-surface-light">
              <div className="h-6 bg-surface-light rounded" />
            </div>
            <div className="p-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="p-3 mb-1">
                  <div className="h-4 bg-surface-light rounded mb-1" />
                  <div className="h-3 bg-surface-light rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1">
          <div className="bg-surface border border-border rounded-lg p-8">
            <div className="space-y-6">
              <div className="h-6 bg-surface-light rounded mb-4" />
              <div className="h-4 bg-surface-light rounded mb-6" />
              <div className="h-10 bg-surface-light rounded mb-4" />
              <div className="h-10 bg-surface-light rounded mb-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { t, language } = useI18n();

  const translations = {
    title: t('admin.settings.title'),
    description: t('admin.settings.description'),
    sections: {
      tracker: t('admin.settings.sections.tracker'),
      ratio: t('admin.settings.sections.ratio'),
      announce: t('admin.settings.sections.announce'),
      clients: t('admin.settings.sections.clients'),
      invitations: t('admin.settings.sections.invitations'),
      rss: t('admin.settings.sections.rss'),
      storage: t('admin.settings.sections.storage'),
      smtp: t('admin.settings.sections.smtp'),
      antiCheat: t('admin.settings.sections.antiCheat'),
      branding: t('admin.settings.sections.branding'),
    },
    details: {
      tracker: t('admin.settings.tracker.description'),
      ratio: t('admin.settings.ratio.description'),
      announce: t('admin.settings.announce.description'),
      clients: t('admin.settings.clients.description'),
      invitations: t('admin.settings.invitations.description'),
      rss: t('admin.settings.rss.description'),
      storage: t('admin.settings.storage.description'),
      smtp: t('admin.settings.smtp.description'),
      antiCheat: t('admin.settings.antiCheat.description'),
      branding: t('admin.settings.branding.description'),
    },
    settings: {
      ui: {
        sectionsTitle: t('admin.settings.ui.sectionsTitle'),
        save: t('admin.settings.ui.save'),
        saving: t('admin.settings.ui.saving'),
        saved: t('admin.settings.ui.saved'),
        errorLoading: t('admin.settings.ui.errorLoading'),
        errorSaving: t('admin.settings.ui.errorSaving'),
        on: t('admin.settings.ui.on'),
        off: t('admin.settings.ui.off'),
        enabled: t('admin.settings.ui.enabled'),
        disabled: t('admin.settings.ui.disabled'),
        smtpTest: t('admin.settings.ui.smtpTest'),
        smtpSuccess: t('admin.settings.ui.smtpSuccess'),
        smtpError: t('admin.settings.ui.smtpError'),
      },
      ratioPresets: {
        title: t('admin.settings.ratioPresets.title'),
        easy: t('admin.settings.ratioPresets.easy'),
        balanced: t('admin.settings.ratioPresets.balanced'),
        strict: t('admin.settings.ratioPresets.strict'),
        custom: t('admin.settings.ratioPresets.custom'),
        active: t('admin.settings.ratioPresets.active'),
        manualTitle: t('admin.settings.ratioPresets.manualTitle'),
        customBadge: t('admin.settings.ratioPresets.customBadge'),
      },
    },
    fields: {
      registrationMode: t('admin.settings.fields.registrationMode'),
      requireTorrentApproval: t('admin.settings.fields.requireTorrentApproval'),
      minRatio: t('admin.settings.fields.minRatio'),
      bonusPointsPerHour: t('admin.settings.fields.bonusPointsPerHour'),
      hitAndRunThreshold: t('admin.settings.fields.hitAndRunThreshold'),
      requiredSeedingMinutes: t('admin.settings.fields.requiredSeedingMinutes'),
      defaultAnnounceInterval: t('admin.settings.fields.defaultAnnounceInterval'),
      minAnnounceInterval: t('admin.settings.fields.minAnnounceInterval'),
      whitelistedClients: t('admin.settings.fields.whitelistedClients'),
      blacklistedClients: t('admin.settings.fields.blacklistedClients'),
      allowedFingerprints: t('admin.settings.fields.allowedFingerprints'),
      rssDefaultCount: t('admin.settings.fields.rssDefaultCount'),
      inviteExpiryHours: t('admin.settings.fields.inviteExpiryHours'),
      maxInvitesPerUser: t('admin.settings.fields.maxInvitesPerUser'),
      storageType: t('admin.settings.fields.storageType'),
      s3Bucket: t('admin.settings.fields.s3Bucket'),
      s3Region: t('admin.settings.fields.s3Region'),
      s3AccessKeyId: t('admin.settings.fields.s3AccessKeyId'),
      s3SecretAccessKey: t('admin.settings.fields.s3SecretAccessKey'),
      smtpHost: t('admin.settings.fields.smtpHost'),
      smtpPort: t('admin.settings.fields.smtpPort'),
      smtpUser: t('admin.settings.fields.smtpUser'),
      smtpPass: t('admin.settings.fields.smtpPass'),
      smtpFrom: t('admin.settings.fields.smtpFrom'),
      ghostLeechingCheck: t('admin.settings.fields.ghostLeechingCheck'),
      cheatingClientCheck: t('admin.settings.fields.cheatingClientCheck'),
      ipAbuseCheck: t('admin.settings.fields.ipAbuseCheck'),
      announceRateCheck: t('admin.settings.fields.announceRateCheck'),
      invalidStatsCheck: t('admin.settings.fields.invalidStatsCheck'),
      peerBanCheck: t('admin.settings.fields.peerBanCheck'),
      maxStatsJumpMultiplier: t('admin.settings.fields.maxStatsJumpMultiplier'),
      brandingName: t('admin.settings.fields.brandingName'),
      showHomePageStats: t('admin.settings.fields.showHomePageStats'),
    }
  };

  return (
    <AdminDashboardWrapper>
      <div className="fixed bottom-4 left-4 z-50">
        <LanguageSelector currentLanguage={language} />
      </div>
      <Suspense fallback={<SettingsSkeleton />}> 
        <SettingsContent translations={translations} />
      </Suspense>
    </AdminDashboardWrapper>
  );
}


