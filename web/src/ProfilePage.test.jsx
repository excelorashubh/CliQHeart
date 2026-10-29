import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProfilePage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

const { authenticatedUser, setUserMock } = vi.hoisted(() => ({
  authenticatedUser: {
    id: '0123456789abcdef01234567',
    username: 'test_user',
    displayName: 'Test User',
    avatarUrl: 'https://res.cloudinary.com/test-cloud/image/upload/profile.jpg',
  },
  setUserMock: vi.fn(),
}));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: authenticatedUser, setUser: setUserMock }),
}));

const profile = {
  ...authenticatedUser,
  bio: 'Existing biography',
  followersCount: 0,
  followingCount: 0,
  postsCount: 0,
  reelsCount: 0,
};

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes><Route path="/profile" element={<ProfilePage />} /></Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('profile editing', () => {
  it('shows the saved photo and saves a bio-only change without sending a photo replacement', async () => {
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    const updateMe = vi.spyOn(userApi, 'updateMe').mockResolvedValue({
      user: { ...profile, bio: 'Updated biography' },
    });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' });
    expect(await screen.findByRole('img', { name: 'Current profile photo' })).toHaveAttribute(
      'src',
      profile.avatarUrl,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /bio/i }), {
      target: { value: 'Updated biography' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({
      username: profile.username,
      displayName: profile.displayName,
      bio: 'Updated biography',
    }));
    expect(updateMe.mock.calls[0][0]).not.toHaveProperty('avatarMediaId');
    expect(updateMe.mock.calls[0][0]).not.toHaveProperty('avatarUrl');
    expect(dialog).not.toBeVisible();
    expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({
      avatarUrl: profile.avatarUrl,
      bio: 'Updated biography',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(await screen.findByRole('img', { name: 'Current profile photo' })).toHaveAttribute(
      'src',
      profile.avatarUrl,
    );
    expect(screen.getByRole('textbox', { name: /bio/i })).toHaveValue('Updated biography');
  });
});
