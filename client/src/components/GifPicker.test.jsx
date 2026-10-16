import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const get = vi.fn();
vi.mock('../lib/api', () => ({
  api: { get: (...args) => get(...args) },
  getErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
}));

const { default: GifPicker } = await import('./GifPicker');

const gif = (id) => ({ providerId: id, title: `gif ${id}`, url: `https://media.giphy.com/${id}.gif`, previewUrl: `https://media.giphy.com/${id}-s.gif`, width: 200, height: 150 });

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe('GifPicker', () => {
  it('loads trending GIFs through the backend proxy and shows GIPHY attribution', async () => {
    get.mockResolvedValue({ data: { gifs: [gif('a'), gif('b')], hasMore: false, nextOffset: 2 } });
    render(<GifPicker onSelect={() => {}} onClose={() => {}} />);
    expect(await screen.findByAltText('gif a')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/gifs/trending', { params: { offset: 0 } });
    expect(screen.getByText(/Powered by GIPHY/i)).toBeInTheDocument();
  });

  it('searches by keyword (debounced) and selects a GIF', async () => {
    get.mockResolvedValue({ data: { gifs: [gif('cat')], hasMore: false, nextOffset: 1 } });
    const onSelect = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search GIFs'), { target: { value: 'cats' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/gifs/search', { params: { q: 'cats', offset: 0 } }));
    fireEvent.click(await screen.findByTitle('gif cat'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'cat' }));
    expect(JSON.parse(localStorage.getItem('pulse-recent-gifs'))[0].providerId).toBe('cat');
  });

  it('shows an error with retry when the provider is not configured', async () => {
    get.mockRejectedValueOnce({ response: { data: { error: { message: 'GIF search is not configured on this server' } } } });
    render(<GifPicker onSelect={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('GIF search is not configured on this server')).toBeInTheDocument();
    get.mockResolvedValue({ data: { gifs: [gif('z')], hasMore: false, nextOffset: 1 } });
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByAltText('gif z')).toBeInTheDocument();
  });
});
