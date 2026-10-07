'use client';
import { useParams, usePathname } from 'next/navigation';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import TorrentDetailContent from './TorrentDetailContent';

export default function TorrentDetailClientShell() {
  const params = useParams();
  const pathname = usePathname();
  let id = typeof params?.id === 'string' ? params.id : (Array.isArray(params?.id) ? params.id[0] : '');
  if (!id || id === '_placeholder') {
    const seg = pathname.split('/').filter(Boolean);
    id = decodeURIComponent(seg[1] || '');
  }
  if (!id) return null;
  return (
    <DashboardWrapper>
      <TorrentDetailContent torrentId={id} />
    </DashboardWrapper>
  );
}
