import { useEffect } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router-dom';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { refreshSession } from '../lib/api';
import { useChat } from '../store/chatStore';
import { useAuth } from '../store/authStore';
import AppSidebar from '../components/AppSidebar';
import ErrorBoundary from '../components/ErrorBoundary';
import ImagePreviewModal from '../components/ImagePreviewModal';
import ForwardModal from '../components/ForwardModal';
import { cn } from '../lib/utils';

export default function ChatLayout() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const atRoot = useMatch({ path: '/', end: true });

  useEffect(() => {
    const chat = useChat.getState();
    const socket = connectSocket();
    chat.attachSocket(socket, { navigate });
    chat.loadConversations().catch(() => {});
    chat.loadNotifications();

    // Refresh the access token before it expires (15 min) so sockets/API calls never stall.
    const refresher = setInterval(() => refreshSession().catch(() => {}), 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const active = useChat.getState().activeId;
        if (active) useChat.getState().markRead(active);
      }
    };
    const onOnline = () => {
      const s = connectSocket();
      if (!s.connected) s.connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(refresher);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      disconnectSocket();
    };
  }, [navigate]);

  return (
    <div className="flex h-dvh overflow-hidden bg-base">
      <div className={cn('h-full w-full shrink-0 border-r border-line md:block md:w-[340px] lg:w-[380px]', atRoot ? 'block' : 'hidden')}>
        <ErrorBoundary>
          <AppSidebar />
        </ErrorBoundary>
      </div>
      <main className={cn('h-full min-w-0 flex-1 md:flex', atRoot ? 'hidden' : 'flex')}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <ImagePreviewModal />
      <ForwardModal meId={me._id} />
    </div>
  );
}
