import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useChat } from '../store/chatStore';
import ChatPresence, { useChatPresence } from './ChatPresence';

const conversation = {
  _id: 'c1',
  type: 'group',
  members: [
    { user: { _id: 'me', name: 'Me Myself' } },
    { user: { _id: 'u1', name: 'Asha Rao' } },
    { user: { _id: 'u2', name: 'Bilal Khan' } },
  ],
};

function Harness() {
  return <ChatPresence people={useChatPresence(conversation, 'me')} />;
}

beforeEach(() => useChat.getState().reset());
afterEach(cleanup);

describe('ChatPresence', () => {
  it('peeks the avatar of whoever has the chat open, never my own', () => {
    render(<Harness />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => useChat.getState().setViewing('c1', 'u1', true));
    act(() => useChat.getState().setViewing('c1', 'me', true));
    expect(screen.getByRole('status')).toHaveTextContent('Asha is here');
    expect(screen.getByTitle('Asha Rao is in the chat')).toBeInTheDocument();
    expect(screen.queryByTitle(/Me Myself/)).not.toBeInTheDocument();

    act(() => useChat.getState().setViewing('c1', 'u1', false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('bobs and shows typing dots while someone types', () => {
    render(<Harness />);
    act(() => {
      useChat.getState().setViewing('c1', 'u1', true);
      useChat.getState().setTyping('c1', 'u2', true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Asha is here, Bilal is typing');
    const typer = screen.getByTitle('Bilal Khan is typing…');
    expect(typer.querySelector('.peek-typing')).not.toBeNull();
    expect(screen.getByTitle('Asha Rao is in the chat').querySelector('.peek-typing')).toBeNull();
  });
});
