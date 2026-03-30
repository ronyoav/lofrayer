// Simple localStorage-based persistence for user preferences

export const getSelectedMemberships = (): string[] => {
  const stored = localStorage.getItem('lofrayer-memberships');
  try {
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const setSelectedMemberships = (ids: string[]) => {
  localStorage.setItem('lofrayer-memberships', JSON.stringify(ids));
};

export const getOnboardingComplete = (): boolean => {
  return localStorage.getItem('lofrayer-onboarding') === 'true';
};

export const setOnboardingComplete = (value: boolean) => {
  localStorage.setItem('lofrayer-onboarding', value ? 'true' : 'false');
};

export const getLocationEnabled = (): boolean => {
  return localStorage.getItem('lofrayer-location') === 'true';
};

export const setLocationEnabled = (value: boolean) => {
  localStorage.setItem('lofrayer-location', value ? 'true' : 'false');
};
