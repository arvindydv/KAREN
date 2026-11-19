// Baseline load-test harness (k6). Measures, does not assert product targets as achieved.
//   docker run --rm --network host -i grafana/k6:1.4.2 run - < scripts/load/api-baseline.k6.js
// Env: API_BASE_URL (default http://localhost:4100), VUS, DURATION.
// Targets from architecture §12 are hypotheses to validate (e.g. simple read p95 < 250 ms in-region).
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.API_BASE_URL || 'http://localhost:4100';

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    // Fails the run (non-zero exit) only on errors; latency is reported for comparison over time.
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const res = http.post(
    `${BASE}/dev/auth/token`,
    JSON.stringify({ subject: 'dev|loadtest-0001' }),
    {
      headers: { 'content-type': 'application/json' },
    },
  );
  return { token: res.status === 200 ? res.json('access_token') : null };
}

export default function (data) {
  check(http.get(`${BASE}/health/live`), { 'live 200': (r) => r.status === 200 });
  if (data.token) {
    const me = http.get(`${BASE}/v1/me`, { headers: { authorization: `Bearer ${data.token}` } });
    check(me, { 'me 200': (r) => r.status === 200 });
  }
}
