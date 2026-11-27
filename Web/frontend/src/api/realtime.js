/**
 * Live sync over Socket.io: while signed in, the app listens to its company's `changed` events
 * (sent by the API after every recorded change) and refreshes cached data, so other people's work
 * shows up without reloading. Bursts of events are batched into one refresh.
 */
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

export const useLiveSync = (token) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!token) return undefined;
    const socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10000 });
    let timer = null;
    socket.on('changed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries(), 400);
    });
    return () => { clearTimeout(timer); socket.disconnect(); };
  }, [token, qc]);
};
