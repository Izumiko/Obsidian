import type { Metadata } from 'next';
import LatestTorrentsPageClient from './components/LatestTorrentsPageClient';

export const metadata: Metadata = { title: 'Latest Torrents' };

export default function LatestTorrentsPage() {
  return <LatestTorrentsPageClient />;
}
