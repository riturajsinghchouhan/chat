// Holds the Socket.IO server instance so REST controllers and services can emit events.
let io = null;

export const setIO = (instance) => {
  io = instance;
};
export const getIO = () => io;

export const userRoom = (userId) => `user:${userId}`;

/** Emit to every connected socket (all tabs/devices) of the given users. */
export function emitToUsers(userIds, event, payload) {
  if (!io || !userIds?.length) return;
  const rooms = [...new Set(userIds.map(String))].map(userRoom);
  io.to(rooms).emit(event, payload);
}

export async function isUserConnected(userId) {
  if (!io) return false;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  return sockets.length > 0;
}

export function disconnectUser(userId) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
