'use client';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import { useI18n } from '@/app/hooks/useI18n';
import DashboardHeader from './DashboardHeader';
import DashboardSidebar from './DashboardSidebar';
import { API_BASE_URL } from '@/lib/api';
import { MobileSidebarProvider } from '../context/MobileSidebarContext';

export default function DashboardWrapper({ children }: { children: ReactNode }) {
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

  const navItems = [
    { href: '/dashboard', label: t('sidebar.nav.home'), icon: 'Home' },
    { href: '/categories', label: t('sidebar.nav.categories'), icon: 'ListUl' },
    { href: '/requests', label: t('sidebar.nav.requests'), icon: 'HelpCircle' },
    { href: '/announcements', label: t('sidebar.nav.announcements'), icon: 'News' },
    { href: '/wiki', label: t('sidebar.nav.wiki'), icon: 'BookOpen' },
    { href: '/rss', label: t('sidebar.nav.rss'), icon: 'Rss' },
    { href: '/bookmarks', label: t('sidebar.nav.bookmarks'), icon: 'Bookmark' },
  ];

  return (
    <MobileSidebarProvider>
      <div className="h-screen bg-background overflow-hidden">
        <Suspense fallback={<div className="h-16 bg-surface border-b border-border fixed top-0 left-0 right-0 z-50" />}>
          <DashboardHeader language={language} brandingName={brandingName} />
        </Suspense>
        <Suspense fallback={<div className="w-64 bg-surface border-r border-border h-[calc(100vh-4rem)] fixed left-0 top-16 z-20" />}>
          <DashboardSidebar navItems={navItems} brandingName={brandingName} currentLanguage={language} />
        </Suspense>
        <main className="h-full lg:ml-64 pt-16 overflow-y-auto">
          <div className="p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </MobileSidebarProvider>
  );
}
