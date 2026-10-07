'use client';
import { Suspense, useEffect, useState } from 'react';
import { useI18n } from '@/app/hooks/useI18n';
import AdminHeader from './AdminHeader';
import { API_BASE_URL } from '@/lib/api';
import AdminSidebar from './AdminSidebar';
import type { AdminNavItem } from './AdminSidebarClient';

export default function AdminDashboardWrapper({ children }: { children: React.ReactNode }) {
  const { t, language } = useI18n();
  const [brandingName, setBrandingName] = useState('Obsidian Tracker');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/config/branding`)
      .then(r => r.json())
      .then(b => { if (!cancelled && b?.brandingName) setBrandingName(b.brandingName); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const items: AdminNavItem[] = [
    { href: '/admin/dashboard', label: t('admin.nav.dashboard'), icon: 'Home' },
    { href: '/admin/users', label: t('admin.nav.users'), icon: 'Group' },
    { href: '/admin/torrent-approvals', label: t('admin.nav.torrentApprovals'), icon: 'CheckShield' },
    { href: '/admin/torrent-management', label: t('admin.nav.torrentManagement'), icon: 'Folder' },
    { href: '/admin/categories', label: t('admin.nav.categories'), icon: 'ListUl' },
    { href: '/admin/ranks', label: t('admin.nav.ranks'), icon: 'Award' },
    { href: '/admin/announcements', label: t('admin.nav.announcements'), icon: 'News' },
    { href: '/admin/wiki', label: t('admin.nav.wiki'), icon: 'BookOpen' },
    { href: '/admin/peerban', label: t('admin.nav.peerban'), icon: 'Shield' },
    { href: '/admin/rss-management', label: t('admin.nav.rssManagement'), icon: 'Rss' },
    { href: '/admin/settings', label: t('admin.nav.configuration'), icon: 'Cog' },
    { href: '/admin/requests', label: t('admin.nav.requests'), icon: 'HelpCircle' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<div className="h-16 bg-surface border-b border-border fixed top-0 left-0 right-0 z-30" />}>
        <AdminHeader language={language} brandingName={brandingName} />
      </Suspense>
      <Suspense fallback={<div className="w-64 bg-surface border-r border-border h-screen fixed left-0 top-16 z-20" />}>
        <AdminSidebar items={items} />
      </Suspense>
      <main className="flex-1 ml-64 pt-20 p-6">
        {children}
      </main>
    </div>
  );
}
