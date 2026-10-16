import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { cn, formatListTime, idOf } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useClickOutside } from '../hooks/useClickOutside';
import { dismissNotificationPrompt, requestNotificationPermission, shouldOfferNotificationPrompt } from '../lib/notify';
import UserAvatar from './UserAvatar';

/** Bell button + dropdown of in-app notifications (group events) and the opt-in for desktop alerts. */
export default function NotificationPanel() {
  const navigate = useNavigate();
  const notifications = useChat((s) => s.notifications);
  const unread = useChat((s) => s.unreadNotifications);
  const [open, setOpen] = useState(false);
  const [offerPrompt, setOfferPrompt] = useState(shouldOfferNotificationPrompt);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const enableDesktop = async () => {
    await requestNotificationPermission();
    setOfferPrompt(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="icon-btn neu-sm relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
        <Bell size={18} />
        {unread > 0 && <span className="neu-accent absolute -top-1 -right-1 min-w-5 rounded-full px-1 text-center text-[10px] leading-5 font-bold">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu animate-pop fixed inset-x-3 top-[72px] p-0 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[340px]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-bold">Notifications</span>
            {unread > 0 && (
              <button type="button" className="flex items-center gap-1 text-xs font-semibold text-accent" onClick={() => useChat.getState().markAllNotificationsRead()}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          {offerPrompt && (
            <div className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-accent-soft p-3 text-xs">
              <BellRing size={18} className="shrink-0 text-accent" />
              <span className="flex-1">Get desktop alerts for new messages while Pulse is in the background.</span>
              <button type="button" className="font-bold text-accent" onClick={enableDesktop}>Enable</button>
              <button type="button" className="text-muted" aria-label="Dismiss" onClick={() => { dismissNotificationPrompt(); setOfferPrompt(false); }}>
                <X size={14} />
              </button>
            </div>
          )}
          <div className="scroll-thin max-h-[min(24rem,calc(100dvh-180px))] overflow-y-auto px-2 pb-2">
            {notifications.length === 0 && <p className="py-8 text-center text-sm text-muted">You're all caught up</p>}
            {notifications.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => {
                  if (!n.read) useChat.getState().markNotificationRead(n._id);
                  setOpen(false);
                  if (n.type !== 'group_removed' && n.conversationId) navigate(`/c/${idOf(n.conversationId)}`);
                }}
                className={cn('flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-accent-soft', !n.read && 'bg-accent-soft/50')}
              >
                <UserAvatar src={n.actor?.avatar} name={n.actor?.name || 'Pulse'} size="sm" ring={false} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{n.text}</div>
                  <div className="text-xs text-muted">{formatListTime(n.createdAt)}</div>
                </div>
                {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
