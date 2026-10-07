import type { Metadata } from 'next';
import WikiPageShell from './components/WikiPageShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Wiki' };

export default function WikiPage() {
  return <WikiPageShell />;
}
