// SPDX-License-Identifier: AGPL-3.0-or-later

// Same-origin edge for running the local web build against a remote Fluxer server.
//
//   localhost:EDGE_PORT  /api, /gateway, /media  ->  https://REMOTE_HOST  (Host and Origin rewritten)
//   localhost:EDGE_PORT  everything else         ->  local fluxer_app_proxy on APP_PROXY_PORT
//
// The discovery document is rewritten so the web app talks to this origin for the API, gateway and
// media. Every request stays same-origin, so the server's CORS allowlist never applies. See README.md.

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const REMOTE_HOST = process.env.REMOTE_HOST?.trim();
if (!REMOTE_HOST) {
	console.error('REMOTE_HOST is required, for example REMOTE_HOST=chat.example.com');
	process.exit(1);
}
const EDGE_PORT = Number(process.env.EDGE_PORT ?? 8773);
const APP_PROXY_PORT = Number(process.env.APP_PROXY_PORT ?? 8774);
const REMOTE_ORIGIN = `https://${REMOTE_HOST}`;
const LOCAL_ORIGIN = `http://localhost:${EDGE_PORT}`;
const LOCAL_WS_ORIGIN = `ws://localhost:${EDGE_PORT}`;

const REMOTE_PREFIXES = ['/api', '/gateway', '/media'];

const remoteAgent = new https.Agent({keepAlive: true, maxSockets: 64});
const appAgent = new http.Agent({keepAlive: true, maxSockets: 64});

function pathOf(url) {
	const query = url.indexOf('?');
	return query === -1 ? url : url.slice(0, query);
}

function isRemote(url) {
	const path = pathOf(url);
	return REMOTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function log(...args) {
	console.log(new Date().toISOString().slice(11, 23), ...args);
}

function rewriteRequestHeaders(headers) {
	const out = {...headers, host: REMOTE_HOST};
	if (out.origin) out.origin = REMOTE_ORIGIN;
	if (out.referer) out.referer = out.referer.replace(/^https?:\/\/localhost:\d+/, REMOTE_ORIGIN);
	return out;
}

function rewriteResponseHeaders(headers) {
	const out = {...headers};
	if (out.location) out.location = out.location.split(REMOTE_ORIGIN).join(LOCAL_ORIGIN);
	if (out['set-cookie']) {
		out['set-cookie'] = out['set-cookie'].map((cookie) =>
			cookie
				.replace(/;\s*Domain=[^;]*/gi, '')
				.replace(/;\s*Secure/gi, '')
				.replace(/;\s*SameSite=None/gi, '; SameSite=Lax'),
		);
	}
	return out;
}

function rewriteDiscovery(doc) {
	const endpoints = doc.endpoints ?? {};
	for (const key of ['api', 'api_client', 'api_public']) {
		if (key in endpoints) endpoints[key] = `${LOCAL_ORIGIN}/api`;
	}
	if ('gateway' in endpoints) endpoints.gateway = `${LOCAL_WS_ORIGIN}/gateway`;
	if ('media' in endpoints) endpoints.media = `${LOCAL_ORIGIN}/media`;
	doc.endpoints = endpoints;
	return doc;
}

function serveDiscovery(_req, res) {
	const headers = {accept: 'application/json', host: REMOTE_HOST, 'accept-encoding': 'identity'};
	const upstream = https.request(
		{host: REMOTE_HOST, port: 443, method: 'GET', path: '/api/.well-known/fluxer', headers, agent: remoteAgent},
		(upstreamRes) => {
			const chunks = [];
			upstreamRes.on('data', (chunk) => chunks.push(chunk));
			upstreamRes.on('end', () => {
				try {
					if (upstreamRes.statusCode !== 200) throw new Error(`upstream status ${upstreamRes.statusCode}`);
					const doc = rewriteDiscovery(JSON.parse(Buffer.concat(chunks).toString('utf8')));
					const body = Buffer.from(JSON.stringify(doc));
					res.writeHead(200, {
						'content-type': 'application/json',
						'content-length': body.length,
						'cache-control': 'no-cache',
						'access-control-allow-origin': '*',
					});
					res.end(body);
				} catch (error) {
					log('discovery failed:', error.message);
					res.writeHead(502, {'content-type': 'text/plain'});
					res.end(`discovery rewrite failed: ${error.message}`);
				}
			});
		},
	);
	upstream.on('error', (error) => {
		log('discovery request error:', error.message);
		res.writeHead(502, {'content-type': 'text/plain'});
		res.end('discovery upstream unreachable');
	});
	upstream.end();
}

function proxyRemote(req, res) {
	const upstream = https.request(
		{
			host: REMOTE_HOST,
			port: 443,
			method: req.method,
			path: req.url,
			headers: rewriteRequestHeaders(req.headers),
			agent: remoteAgent,
			servername: REMOTE_HOST,
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, rewriteResponseHeaders(upstreamRes.headers));
			upstreamRes.pipe(res);
		},
	);
	upstream.on('error', (error) => {
		log('remote proxy error:', req.method, req.url, error.message);
		if (!res.headersSent) res.writeHead(502, {'content-type': 'text/plain'});
		res.end('upstream error');
	});
	req.pipe(upstream);
}

function proxyLocal(req, res) {
	const upstream = http.request(
		{host: '127.0.0.1', port: APP_PROXY_PORT, method: req.method, path: req.url, headers: req.headers, agent: appAgent},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
			upstreamRes.pipe(res);
		},
	);
	upstream.on('error', (error) => {
		log('local app proxy error:', req.method, req.url, error.message);
		if (!res.headersSent) res.writeHead(502, {'content-type': 'text/plain'});
		res.end('local app proxy unreachable');
	});
	req.pipe(upstream);
}

const server = http.createServer((req, res) => {
	const url = req.url ?? '/';
	if (req.method === 'GET' && pathOf(url) === '/api/.well-known/fluxer') {
		serveDiscovery(req, res);
	} else if (isRemote(url)) {
		proxyRemote(req, res);
	} else {
		proxyLocal(req, res);
	}
});

server.on('upgrade', (req, socket, head) => {
	if (!isRemote(req.url ?? '/')) {
		socket.destroy();
		return;
	}
	log('ws upgrade', pathOf(req.url));
	const upstream = tls.connect({host: REMOTE_HOST, port: 443, servername: REMOTE_HOST}, () => {
		let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
		for (let i = 0; i < req.rawHeaders.length; i += 2) {
			const name = req.rawHeaders[i];
			let value = req.rawHeaders[i + 1];
			const lower = name.toLowerCase();
			if (lower === 'host') value = REMOTE_HOST;
			else if (lower === 'origin') value = REMOTE_ORIGIN;
			raw += `${name}: ${value}\r\n`;
		}
		raw += '\r\n';
		upstream.write(raw);
		if (head && head.length > 0) upstream.write(head);
		socket.pipe(upstream);
		upstream.pipe(socket);
	});
	const close = () => {
		socket.destroy();
		upstream.destroy();
	};
	upstream.on('error', (error) => {
		log('ws upstream error:', error.message);
		close();
	});
	upstream.on('close', close);
	socket.on('error', close);
	socket.on('close', close);
});

server.listen(EDGE_PORT, '127.0.0.1', () => {
	log(`edge listening on ${LOCAL_ORIGIN} -> ${REMOTE_ORIGIN} (app proxy on :${APP_PROXY_PORT})`);
});
