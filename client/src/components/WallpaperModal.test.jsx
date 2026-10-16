import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = { patch: vi.fn(), post: vi.fn(), get: vi.fn() };
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal()), api }));

const { useAuth } = await import('../store/authStore');
const { useChat } = await import('../store/chatStore');
const { default: WallpaperModal } = await import('./WallpaperModal');
const { effectiveWallpaper, toWallpaperInput } = await import('../lib/wallpapers');

const conversation = { _id: 'c1', type: 'direct', members: [], me: { wallpaper: null } };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.get.mockResolvedValue({ data: new Blob(['img']) });
  URL.createObjectURL = vi.fn(() => 'blob:wallpaper');
  useAuth.setState({ user: { _id: 'me', name: 'Me', settings: { wallpaper: { kind: 'preset', value: 'ocean', dim: 0 } } } });
});
afterEach(cleanup);

describe('wallpaper helpers', () => {
  it('uses the chat wallpaper, else the default; "none" means plain', () => {
    const user = { settings: { wallpaper: { kind: 'color', value: '#000000' } } };
    expect(effectiveWallpaper({ me: { wallpaper: null } }, user)).toEqual(user.settings.wallpaper);
    expect(effectiveWallpaper({ me: { wallpaper: { kind: 'preset', value: 'sunset' } } }, user).value).toBe('sunset');
    expect(effectiveWallpaper({ me: { wallpaper: { kind: 'none' } } }, user)).toBeNull();
    expect(toWallpaperInput({ kind: 'image', mediaId: 'm1', url: '/api/media/m1', dim: 20 })).toEqual({ kind: 'image', mediaId: 'm1', dim: 20 });
  });
});

describe('WallpaperModal', () => {
  it('sets a preset for this chat only', async () => {
    api.patch.mockResolvedValue({ data: { conversation: { ...conversation, me: { wallpaper: { kind: 'preset', value: 'sunset', dim: 0 } } } } });
    const onClose = vi.fn();
    render(<WallpaperModal open onClose={onClose} conversation={conversation} />);
    // Inherits the default until changed
    expect(screen.getByLabelText('Use default wallpaper')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Save')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Sunset'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/conversations/c1', { wallpaper: { kind: 'preset', value: 'sunset', dim: 0 } }));
    expect(useChat.getState().conversations.c1.me.wallpaper.value).toBe('sunset');
    expect(onClose).toHaveBeenCalled();
  });

  it('uploads a photo with dimming and saves it as the default for all chats', async () => {
    api.post.mockResolvedValue({ data: { media: { mediaId: 'w1', url: '/api/media/w1' } } });
    api.patch.mockResolvedValue({ data: { user: { settings: { wallpaper: { kind: 'image', mediaId: 'w1', url: '/api/media/w1', dim: 40 } } } } });
    render(<WallpaperModal open onClose={() => {}} conversation={conversation} />);
    fireEvent.click(screen.getByRole('tab', { name: 'All chats (default)' }));

    const file = new File(['img'], 'beach.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('wallpaper-file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText('Upload a photo')).toHaveAttribute('aria-pressed', 'true'));
    expect(api.post.mock.calls[0][0]).toBe('/users/wallpaper');
    expect(screen.getByLabelText('Dim wallpaper')).toHaveValue('20');

    fireEvent.change(screen.getByLabelText('Dim wallpaper'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/settings', { wallpaper: { kind: 'image', mediaId: 'w1', dim: 40 } }));
    expect(useAuth.getState().user.settings.wallpaper.mediaId).toBe('w1');
  });

  it('rejects non-image uploads', async () => {
    render(<WallpaperModal open onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('wallpaper-file'), { target: { files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] } });
    expect(api.post).not.toHaveBeenCalled();
  });
});
