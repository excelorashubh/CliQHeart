import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SettingsPage } from './pages.jsx';
import { userApi } from './services/api.js';

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { displayName: 'Test User', username: 'test_user', avatarUrl: '' },
    signOut: signOutMock,
  }),
}));

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<p>Logged-out landing page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  signOutMock.mockReset();
});

describe('account deletion settings', () => {
  it('requires password confirmation and clears the local session only after API success', async () => {
    const deleteAccount = vi.spyOn(userApi, 'deleteAccount').mockResolvedValue(null);
    signOutMock.mockResolvedValue({ remoteRevoked: true, error: '' });
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith({ password: 'current-password' }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledOnce());
    expect(await screen.findByText('Logged-out landing page')).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
  });

  it('preserves the session and reports API failures without claiming deletion', async () => {
    vi.spyOn(userApi, 'deleteAccount').mockRejectedValue(new Error('Deletion could not be completed.'));
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion could not be completed.');
    expect(signOutMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toBeInTheDocument();
  });

  it('does not send a request if the confirmation is cancelled', async () => {
    const deleteAccount = vi.spyOn(userApi, 'deleteAccount').mockResolvedValue(null);
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
