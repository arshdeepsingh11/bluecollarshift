import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { supabase } from './supabase';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(API_URL, {
    path: '/realtime',
    transports: ['websocket'],
    auth: async (cb) => {
      const { data } = await supabase.auth.getSession();
      cb({ token: data.session?.access_token ?? '' });
    },
    reconnectionDelayMax: 20_000,
  });
  return socket;
}

export function closeSocket() {
  socket?.close();
  socket = null;
}
