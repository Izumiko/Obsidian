import type { Metadata } from 'next';
import InviteSignupShell from './components/InviteSignupShell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ code: '_placeholder' }];
}

export const metadata: Metadata = { title: 'Sign Up' };

export default function InviteSignupPage() {
  return <InviteSignupShell />;
}
