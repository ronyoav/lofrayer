import { create } from 'zustand';

// Simple state management without zustand dependency - using React context pattern instead
// We'll use localStorage for persistence

export const getSelectedMemberships = (): string[] => {
  const stored = localStorage.getItem('lofrayer-memberships');
  return stored ? JSON.parse(stored) : [];
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
