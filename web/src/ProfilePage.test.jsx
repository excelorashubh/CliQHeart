import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProfilePage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

const { authenticatedUser, setUserMock, uploadedProfileMedia } = vi.hoisted(() => ({
  authenticatedUser: {
    id: '0123456789abcdef01234567',
    username: 'test_user',
    displayName: 'Test User',
    avatarUrl: 'https://res.cloudinary.com/test-cloud/image/upload/profile.jpg',
  },
  setUserMock: vi.fn(),
  uploadedProfileMedia: {
    id: 'fedcbafedcbafedcbafedcba',
    secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/new-profile.jpg',
    status: 'ready',
  },
}));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: authenticatedUser, setUser: setUserMock }),
}));

vi.mock('./components/MediaUploader.jsx', () => ({
  MediaUploader: ({ currentImageUrl, onReady }) => (
    <div>
      {currentImageUrl && <img src={currentImageUrl} alt="Current profile photo" />}
      <button type="button" onClick={() => onReady(uploadedProfileMedia)}>Mock upload photo</button>
    </div>
  ),
}));

const profile = {
  ...authenticatedUser,
  bio: 'Existing biography',
  followersCount: 0,
  followingCount: 0,
  postsCount: 0,
  reelsCount: 0,
};

function renderProfile(path = '/profile') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('profile editing', () => {
  it('shows the saved photo and saves a bio-only change without sending a photo replacement', async () => {
    setUserMock.mockClear();
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    const updateMe = vi.spyOn(userApi, 'updateMe').mockResolvedValue({
      user: { ...profile, bio: 'Updated biography' },
    });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' });
    expect(await screen.findByAltText('Current profile photo')).toHaveAttribute(
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
    expect(await screen.findByAltText('Current profile photo')).toHaveAttribute(
      'src',
      profile.avatarUrl,
    );
    expect(screen.getByRole('textbox', { name: /bio/i })).toHaveValue('Updated biography');
  });

  it('shows the camera actions only on the signed-in user profile', async () => {
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    renderProfile();

    const cameraButton = await screen.findByRole('button', { name: 'Change profile photo' });
    fireEvent.click(cameraButton);
    expect(await screen.findByRole('menu', { name: 'Profile photo actions' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change profile photo/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /delete profile photo/i })).toBeInTheDocument();
  });

  it('does not show camera actions on another user profile', async () => {
    vi.spyOn(userApi, 'profile').mockResolvedValue({
      user: { ...profile, id: '1123456789abcdef01234567' },
    });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    renderProfile('/profile/1123456789abcdef01234567');
    expect(await screen.findByRole('heading', { name: 'test_user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change profile photo' })).not.toBeInTheDocument();
  });

  it('keeps the existing image when a replacement save fails', async () => {
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    vi.spyOn(userApi, 'updateMe').mockRejectedValue(new Error('Profile update failed.'));
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Change profile photo' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /change profile photo/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mock upload photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Profile update failed.');
    expect(screen.getByAltText('Current profile photo')).toHaveAttribute('src', profile.avatarUrl);
    expect(screen.getByRole('dialog', { name: 'Change profile photo' })).toBeInTheDocument();
  });

  it('updates the shared profile avatar after a verified replacement is saved', async () => {
    setUserMock.mockClear();
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    const updatedUser = {
      ...profile,
      avatarUrl: uploadedProfileMedia.secureUrl,
    };
    const updateMe = vi.spyOn(userApi, 'updateMe').mockResolvedValue({ user: updatedUser });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    const view = renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Change profile photo' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /change profile photo/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mock upload photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({
      avatarMediaId: uploadedProfileMedia.id,
    }));
    expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({
      avatarUrl: uploadedProfileMedia.secureUrl,
    }));
    expect(view.container.querySelector('.profile-photo-wrap .avatar img')).toHaveAttribute(
      'src',
      uploadedProfileMedia.secureUrl,
    );
    expect(screen.queryByRole('dialog', { name: 'Change profile photo' })).not.toBeInTheDocument();
  });

  it('requires confirmation before deleting and then updates the shared avatar state', async () => {
    setUserMock.mockClear();
    vi.spyOn(userApi, 'me').mockResolvedValue({ user: authenticatedUser });
    vi.spyOn(userApi, 'profile').mockResolvedValue({ user: profile });
    const deletedUser = { ...profile };
    delete deletedUser.avatarUrl;
    const deleteProfilePhoto = vi.spyOn(userApi, 'deleteProfilePhoto').mockResolvedValue({
      user: deletedUser,
    });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({ posts: [] });
    const view = renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Change profile photo' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete profile photo/i }));
    expect(await screen.findByRole('alertdialog', { name: 'Remove your profile photo?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteProfilePhoto).not.toHaveBeenCalled();
    expect(view.container.querySelector('.profile-photo-wrap .avatar img')).toHaveAttribute('src', profile.avatarUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Change profile photo' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete profile photo/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(deleteProfilePhoto).toHaveBeenCalledTimes(1));
    expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: null }));
    expect(view.container.querySelector('.profile-photo-wrap .avatar img')).toBeNull();
  });
});
