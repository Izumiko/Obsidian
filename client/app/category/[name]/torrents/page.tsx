import type { Metadata } from 'next';
import { Suspense } from 'react';
import CategoryTorrentsShell from './components/CategoryTorrentsShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ name: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Category' };

export default function CategoryTorrentsPage() {
  return (
    <Suspense fallback={null}>
      <CategoryTorrentsShell />
    </Suspense>
  );
}
