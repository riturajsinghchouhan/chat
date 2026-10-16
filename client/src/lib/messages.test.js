import { describe, expect, it } from 'vitest';
import { applyDelivered, applyRead, canDeleteForEveryone, isSelectable, mergeMessages } from './messages';

const me = { _id: 'me' };
const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

describe('mergeMessages', () => {
  it('replaces an optimistic message with the persisted copy (no duplicate)', () => {
    const optimistic = { _id: 'c1', clientId: 'c1', senderId: me, text: 'hi', status: 'sending', createdAt: t(1), localPreview: 'blob:x' };
    const saved = { _id: 'srv1', clientId: 'c1', senderId: me, text: 'hi', status: 'sent', createdAt: t(1) };
    const out = mergeMessages([optimistic], [saved]);
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe('srv1');
    expect(out[0].localPreview).toBe('blob:x');
  });

  it('ignores the same server message delivered twice (ack + socket echo, reconnect resync)', () => {
    const saved = { _id: 'srv1', clientId: 'c1', senderId: me, status: 'sent', createdAt: t(1) };
    const out = mergeMessages(mergeMessages([], [saved]), [saved, saved]);
    expect(out).toHaveLength(1);
  });

  it('never downgrades a status (late ack after a read receipt)', () => {
    const read = { _id: 'srv1', clientId: 'c1', senderId: me, status: 'read', createdAt: t(1) };
    const lateAck = { ...read, status: 'sent' };
    expect(mergeMessages([read], [lateAck])[0].status).toBe('read');
  });

  it('keeps chronological order when older pages are merged in', () => {
    const newer = [{ _id: 'b', senderId: me, createdAt: t(5) }];
    const older = [{ _id: 'a', senderId: me, createdAt: t(1) }];
    expect(mergeMessages(newer, older).map((m) => m._id)).toEqual(['a', 'b']);
  });

  it('does not confuse two senders that happen to reuse a clientId', () => {
    const mine = { _id: 'x1', clientId: 'same', senderId: me, createdAt: t(1) };
    const theirs = { _id: 'x2', clientId: 'same', senderId: { _id: 'other' }, createdAt: t(2) };
    expect(mergeMessages([mine], [theirs])).toHaveLength(2);
  });
});

describe('receipts', () => {
  const mine = (id, s, status = 'sent') => ({ _id: id, senderId: me, createdAt: t(s), status, readBy: [] });

  it('applyDelivered upgrades sent → delivered only for listed ids', () => {
    const out = applyDelivered([mine('a', 1), mine('b', 2)], ['a'], 'bob', t(3));
    expect(out.map((m) => m.status)).toEqual(['delivered', 'sent']);
  });

  it('applyRead marks direct messages up to readAt as read', () => {
    const out = applyRead([mine('a', 1), mine('b', 10)], { meId: 'me', readerId: 'bob', readAt: t(5), isGroup: false, memberCount: 2 });
    expect(out.map((m) => m.status)).toEqual(['read', 'sent']);
  });

  it('applyRead in a group only marks read once everyone else has read', () => {
    const opts = { meId: 'me', readAt: t(5), isGroup: true, memberCount: 3 };
    let list = applyRead([mine('a', 1)], { ...opts, readerId: 'bob' });
    expect(list[0].status).toBe('delivered');
    list = applyRead(list, { ...opts, readerId: 'carol' });
    expect(list[0].status).toBe('read');
  });

  it('does not touch messages still sending or failed', () => {
    const out = applyRead([mine('a', 1, 'failed')], { meId: 'me', readerId: 'bob', readAt: t(5), isGroup: false, memberCount: 2 });
    expect(out[0].status).toBe('failed');
  });
});

describe('message deletion helpers', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

  it('allows delete-for-everyone only for own, recent, persisted messages', () => {
    expect(canDeleteForEveryone({ senderId: me, type: 'text', status: 'sent', createdAt: at(5) }, 'me', now)).toBe(true);
    expect(canDeleteForEveryone({ senderId: { _id: 'other' }, type: 'text', status: 'sent', createdAt: at(5) }, 'me', now)).toBe(false);
    expect(canDeleteForEveryone({ senderId: me, type: 'text', status: 'sent', createdAt: at(61) }, 'me', now)).toBe(false);
    expect(canDeleteForEveryone({ senderId: me, type: 'text', status: 'sending', createdAt: at(0) }, 'me', now)).toBe(false);
    expect(canDeleteForEveryone({ senderId: me, type: 'video', status: 'read', createdAt: at(1), deletedAt: at(0) }, 'me', now)).toBe(false);
  });

  it('only lets persisted, non-system messages be selected', () => {
    expect(isSelectable({ type: 'video', status: 'delivered' })).toBe(true);
    expect(isSelectable({ type: 'system', status: 'sent' })).toBe(false);
    expect(isSelectable({ type: 'text', status: 'failed' })).toBe(false);
  });
});
