import { createServer, type Server } from 'node:http';

/**
 * Minimal health endpoint for ECS/container probes.
 * live  = process responsive; ready = worker polling Temporal.
 */
export function startHealthServer(port: number, isReady: () => boolean): Server {
  const server = createServer((req, res) => {
    const ready = isReady();
    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    } else if (req.url === '/health/ready') {
      res
        .writeHead(ready ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(port, '0.0.0.0');
  return server;
}
