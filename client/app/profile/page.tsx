'use client';

import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import ProfileContent from '@/app/profile/components/ProfileContent';
import { useI18n } from '@/app/hooks/useI18n';

export default function ProfilePage() {
  const { t } = useI18n();
  // Title translation loaded to ensure consistent i18n (not used directly here)
  t('profile.title');
  return (
    <DashboardWrapper>
      <ProfileContent />
    </DashboardWrapper>
  );
}
