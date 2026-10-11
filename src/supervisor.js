// Runs src/server.js and restarts it whenever it exits unexpectedly, so the
// agent can be left running for days. Optionally keeps the computer from
// going to sleep while it runs (KEEP_AWAKE=true in .env).
//
//   npm start          -> this supervisor (recommended)
//   npm run start:once -> server.js directly, no auto-restart
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');

// server.js exits with this code for problems a restart can't fix (e.g. a
// missing API key), so we don't loop forever on them.
const EXIT_CONFIG_ERROR = 78;
const MIN_BACKOFF_MS = 2 * 1000;
const MAX_BACKOFF_MS = 60 * 1000;
// A child that stayed up this long counts as healthy, resetting the backoff.
const HEALTHY_RUN_MS = 5 * 60 * 1000;

const serverPath = path.join(__dirname, 'server.js');
let child = null;
let stopping = false;
let backoff = MIN_BACKOFF_MS;
let keepAwakeProc = null;

function log(msg) {
  console.log(`[supervisor ${new Date().toISOString()}] ${msg}`);
}

function startKeepAwake() {
  const pid = String(process.pid);
  let cmd;
  let args;
  if (process.platform === 'darwin') {
    // -i: no idle sleep, -s: no system sleep on AC power; ends when we exit.
    cmd = 'caffeinate';
    args = ['-is', '-w', pid];
  } else if (process.platform === 'win32') {
    // Periodically tell Windows the system is in use (ES_SYSTEM_REQUIRED), and
    // stop once the supervisor process is gone.
    const script = `
      Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
      while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) {
        [W.P]::SetThreadExecutionState(1) | Out-Null
        Start-Sleep -Seconds 30
      }`;
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-Command', script];
  } else {
    cmd = 'systemd-inhibit';
    args = ['--what=sleep:idle', '--who=whatsapp-ai-agent', '--why=Agent is running', 'sleep', 'infinity'];
  }

  keepAwakeProc = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
  keepAwakeProc.on('error', (err) => {
    log(`Could not keep the computer awake (${cmd}: ${err.message}). Continuing without it.`);
    keepAwakeProc = null;
  });
  log('Keeping the computer awake while the agent runs (KEEP_AWAKE=true).');
}

function startChild() {
  const startedAt = Date.now();
  log('Starting agent...');
  child = spawn(process.execPath, [serverPath], { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return shutdown();

    if (code === EXIT_CONFIG_ERROR) {
      log('Agent exited because of a configuration problem - fix .env and run npm start again.');
      return shutdown(1);
    }

    if (Date.now() - startedAt > HEALTHY_RUN_MS) backoff = MIN_BACKOFF_MS;
    log(`Agent exited (${signal || `code ${code}`}). Restarting in ${Math.round(backoff / 1000)}s...`);
    setTimeout(startChild, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  });
}

function shutdown(code = 0) {
  if (keepAwakeProc) keepAwakeProc.kill();
  process.exit(code);
}

function stop() {
  if (stopping) return;
  stopping = true;
  log('Stopping...');
  if (!child) return shutdown();
  child.kill('SIGTERM');
  // Don't hang forever if the child ignores the signal.
  setTimeout(() => {
    if (child) child.kill('SIGKILL');
    shutdown();
  }, 15 * 1000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

if (String(process.env.KEEP_AWAKE).toLowerCase() === 'true') startKeepAwake();
startChild();
