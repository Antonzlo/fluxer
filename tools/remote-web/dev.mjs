// SPDX-License-Identifier: AGPL-3.0-or-later

// Usage: pnpm dev:remote <server-host> [extra CSP connect-src entries, e.g. wss://livekit.example.com]
// Starts the web dev server, the app proxy and the same-origin edge. Ctrl+C stops all three. See README.md.

import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

const [host, ...extraConnectSrc] = process.argv.slice(2);
if (!host) {
	console.error('Usage: pnpm dev:remote <server-host> [extra connect-src entries]');
	process.exit(1);
}

const root = path.resolve(import.meta.dirname, '../..');
const appDir = path.join(root, 'fluxer_app');
const win = process.platform === 'win32';
const run = (cmd, args, cwd, env = {}) =>
	spawn(cmd, args, {cwd, env: {...process.env, ...env}, stdio: 'inherit', shell: win});

// Windows: pnpm scripts need bash for ../tools/ci/run.sh, and the wasm build needs an LLVM clang.
const toolEnv = {FLUXER_APP_DEV_PORT: '3000'};
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const llvm = 'C:\\Program Files\\LLVM\\bin';
if (win && existsSync(gitBash)) toolEnv.pnpm_config_script_shell = gitBash;
if (win && existsSync(llvm)) {
	toolEnv.CC_wasm32_unknown_unknown = path.join(llvm, 'clang.exe');
	toolEnv.AR_wasm32_unknown_unknown = path.join(llvm, 'llvm-ar.exe');
}

const children = [];
let stopping = false;
function stopAll(code) {
	if (stopping) return;
	stopping = true;
	for (const child of children) {
		if (child.pid === undefined) continue;
		if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
		else child.kill();
	}
	process.exit(code);
}
const start = (name, child) => {
	children.push(child);
	child.on('exit', (code) => {
		console.error(`[dev:remote] ${name} exited (${code})`);
		stopAll(code ?? 1);
	});
};

if (win) {
	// The generator step ends by launching Unix-only shims, so a nonzero exit is expected here.
	// ponytail: skips the CSS-module typings watcher on Windows, rerun this command after editing *.module.css.
	spawnSync('cargo', ['run', '--manifest-path', '../tools/ci/Cargo.toml', '--', 'app-dev-server'], {
		cwd: appDir,
		env: {...process.env, ...toolEnv},
		stdio: 'inherit',
		shell: true,
	});
	start('web', run('pnpm', ['exec', 'rspack', 'serve', '--mode', 'development'], appDir, toolEnv));
} else {
	start('web', run('pnpm', ['dev'], appDir, toolEnv));
}

start(
	'app-proxy',
	run('cargo', ['run', '-p', 'fluxer_app_proxy'], root, {
		DISCOVERY_UPSTREAM_URL: 'http://127.0.0.1:8773/api/.well-known/fluxer',
		PUBLIC_BOOTSTRAP_API_ENDPOINT: '/api',
		PUBLIC_BOOTSTRAP_API_PUBLIC_ENDPOINT: 'http://localhost:8773/api',
		FLUXER_APP_PROXY_INDEX_UPSTREAM_URL: 'http://127.0.0.1:3000/',
		FLUXER_APP_PROXY_HOST: '127.0.0.1',
		FLUXER_APP_PROXY_PORT: '8774',
		FLUXER_STATIC_CDN_ENDPOINT: 'http://127.0.0.1:3000',
		FLUXER_STATIC_DIR: 'fluxer_static',
		RELEASE_CHANNEL: 'canary',
		FLUXER_CSP_EXTRA_CONNECT_SRC: [`wss://${host}`, ...extraConnectSrc].join(' '),
	}),
);
start('edge', run('node', ['tools/remote-web/edge.mjs'], root, {REMOTE_HOST: host}));

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
