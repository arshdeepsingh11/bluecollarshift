import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { supabase } from './supabaseClient';

/**
 * One authenticated Socket.IO connection per tab. Messages are persisted by the API before they
 * are emitted, so a dropped connection never loses data — on reconnect, screens re-fetch.
 */
let socket: Socket | null = null;
const listeners = new Set<(online: boolean) => void>();

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(API_URL, {
    path: '/realtime',
    transports: ['websocket'],
    auth: async (cb) => {
      const { data } = await supabase.auth.getSession();
      cb({ token: data.session?.access_token ?? '' });
    },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15_000,
  });
  socket.on('connect', () => listeners.forEach((l) => l(true)));
  socket.on('disconnect', () => listeners.forEach((l) => l(false)));
  return socket;
}

export function onConnectionChange(fn: (online: boolean) => void) {
  listeners.add(fn);
  fn(!!socket?.connected);
  return () => {
    listeners.delete(fn);
  };
}

export function closeSocket() {
  socket?.close();
  socket = null;
}
