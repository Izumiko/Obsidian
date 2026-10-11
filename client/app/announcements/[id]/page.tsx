import type { Metadata } from 'next';
import AnnouncementDetailShell from './components/AnnouncementDetailShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Announcement' };

export default function AnnouncementDetailPage() {
  return <AnnouncementDetailShell />;
}
