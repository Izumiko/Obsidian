import type { Metadata } from 'next';
import PublicProfileShell from './components/PublicProfileShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ username: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Profile' };

export default function PublicProfilePage() {
  return <PublicProfileShell />;
}
