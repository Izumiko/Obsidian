import type { Metadata } from 'next';
import TorrentDetailClientShell from './components/TorrentDetailClientShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Torrent' };

export default function TorrentPage() {
  return <TorrentDetailClientShell />;
}
