import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const connectError = new Rate('ws_connect_errors');
const eventsReceived = new Counter('socket_events_received');

export const options = {
  scenarios: {
    socket_load: {
      executor: 'constant-vus',
      vus: 100,
      duration: '3m',
    },
  },
  thresholds: {
    ws_connect_errors: ['rate<0.05'],
    ws_session_duration: ['p(95)<10000'],
  },
};

export default function () {
  const SOCKET_URL = (__ENV.SOCKET_URL || 'ws://localhost:5000').replace('http', 'ws');
  const TOKEN = __ENV.ADMIN_TOKEN || '';
  const HOTEL_ID = __ENV.HOTEL_ID || '';

  const url = `${SOCKET_URL}?token=${TOKEN}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ event: 'join_hotel', data: HOTEL_ID }));
    });

    socket.on('message', (msg) => {
      eventsReceived.add(1);
    });

    socket.on('error', () => {
      connectError.add(1);
    });

    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  check(res, { 'ws connected': r => r && r.status === 101 });
  if (!res || res.status !== 101) {
    connectError.add(1);
  }

  sleep(1);
}
