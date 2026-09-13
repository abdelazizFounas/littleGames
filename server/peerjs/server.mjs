import { PeerServer } from 'peer';

let httpServer;
const sockets = new Set();
PeerServer(
  {
    port: 9000,
    path: '/peerjs',
    proxied: true,
    allow_discovery: false,
    concurrent_limit: 500,
    alive_timeout: 60000,
  },
  (server) => {
    httpServer = server;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  },
);
function stop() {
  // HTTP close alone leaves upgraded signaling WebSockets alive.
  for (const socket of sockets) socket.destroy();
  if (httpServer) httpServer.close(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
