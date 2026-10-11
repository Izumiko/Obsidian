import type { Metadata } from 'next';
import HomePageClient from './components/HomePageClient';

export const metadata: Metadata = { title: 'Obsidian Tracker' };

export default function Home() {
  return <HomePageClient />;
}
