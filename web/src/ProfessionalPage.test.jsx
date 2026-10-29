import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  ProfessionalDashboardPage,
  ProfessionalOnboardingPage,
  ProfessionalPromotionsPage,
} from './pages/Professional.jsx';
import { contentApi, professionalApi } from './services/api.js';

const { updateUserMock } = vi.hoisted(() => ({ updateUserMock: vi.fn() }));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: '0123456789abcdef01234567', displayName: 'Test Creator', accountType: 'CREATOR' },
    updateUser: updateUserMock,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  updateUserMock.mockReset();
});

describe('professional account pages', () => {
  it('resumes saved onboarding data and persists the next wizard step', async () => {
    const saveStep = vi.spyOn(professionalApi, 'saveOnboardingStep').mockResolvedValue({
      professional: {
        accountType: 'CREATOR',
        category: 'DIGITAL_CREATOR',
        onboardingDraft: { accountType: 'CREATOR', category: 'DIGITAL_CREATOR' },
      },
    });
    vi.spyOn(professionalApi, 'me').mockResolvedValue({
      professional: {
        accountType: 'PERSONAL',
        category: null,
        profile: null,
        onboardingDraft: { accountType: 'CREATOR' },
      },
    });

    render(<MemoryRouter><ProfessionalOnboardingPage /></MemoryRouter>);
    expect(await screen.findByText('What best describes you?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(saveStep).toHaveBeenCalledWith({
      step: 'category',
      category: 'DIGITAL_CREATOR',
    }));
    expect(await screen.findByText('Add optional contact details')).toBeInTheDocument();
  });

  it.each(['CREATOR', 'BUSINESS'])('saves a selected %s account type as the first onboarding draft', async (accountType) => {
    const saveStep = vi.spyOn(professionalApi, 'saveOnboardingStep').mockResolvedValue({
      professional: { accountType, onboardingDraft: { accountType } },
      user: { id: 'existing-id', accountType },
    });
    vi.spyOn(professionalApi, 'me').mockResolvedValue({
      professional: { accountType: 'PERSONAL', onboardingDraft: null },
    });

    render(<MemoryRouter><ProfessionalOnboardingPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /Creator/ });
    fireEvent.click(screen.getByRole('button', { name: accountType === 'CREATOR' ? /Creator/ : /Business/ }));
    expect(screen.getByRole('button', { name: accountType === 'CREATOR' ? /Creator/ : /Business/ }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(saveStep).toHaveBeenCalledWith({ step: 'type', accountType }));
    expect(updateUserMock).toHaveBeenCalledWith({ id: 'existing-id', accountType });
    expect(await screen.findByText('What best describes you?')).toBeInTheDocument();
  });

  it('prevents duplicate onboarding requests while a selection is being saved', async () => {
    let finishSave;
    const saveStep = vi.spyOn(professionalApi, 'saveOnboardingStep').mockImplementation(() =>
      new Promise((resolve) => { finishSave = resolve; }),
    );
    vi.spyOn(professionalApi, 'me').mockResolvedValue({
      professional: { accountType: 'PERSONAL', onboardingDraft: null },
    });
    render(<MemoryRouter><ProfessionalOnboardingPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /Creator/ });

    const submit = screen.getByRole('button', { name: 'Save and continue' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(saveStep).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    finishSave({
      professional: { accountType: 'PERSONAL', onboardingDraft: { accountType: 'CREATOR' } },
    });
    expect(await screen.findByText('What best describes you?')).toBeInTheDocument();
  });

  it('labels dashboard analytics accurately and displays measured data', async () => {
    vi.spyOn(professionalApi, 'dashboard').mockResolvedValue({
      analytics: {
        rangeDays: 30,
        totals: { followers: 42, following: 12, posts: 8, reels: 3 },
        dailyUniqueEvents: [{ day: '2026-10-29', event: 'profile_view', count: 2 }],
        topContent: [],
        recentActivity: [],
        metricDefinition: 'Unique signed-in viewers per UTC day; impressions and reach are not available.',
      },
    });
    vi.spyOn(professionalApi, 'me').mockResolvedValue({
      professional: { accountType: 'CREATOR', category: 'DIGITAL_CREATOR', profile: null },
    });

    render(<MemoryRouter><ProfessionalDashboardPage /></MemoryRouter>);

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('Unique signed-in viewers per UTC day; impressions and reach are not available.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Unique viewer-days' })).toBeInTheDocument();
  });

  it('creates promotion drafts without representing them as active ads', async () => {
    vi.spyOn(professionalApi, 'campaigns').mockResolvedValue({ campaigns: [], billing: { configured: false } });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    vi.spyOn(professionalApi, 'createCampaign').mockResolvedValue({
      campaign: { id: 'draft-id', status: 'DRAFT' },
    });

    render(<MemoryRouter><ProfessionalPromotionsPage /></MemoryRouter>);

    expect(await screen.findByText('Promotion drafts')).toBeInTheDocument();
    expect(screen.getByText(/does not currently have a payment provider/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
  });
});
