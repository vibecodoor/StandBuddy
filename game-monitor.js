// game-monitor.js
// Persistent, hidden helper that reports the FOREGROUND window's process name.
//
// Design:
//  - Spawns one long-lived powershell.exe (windowsHide, no profile, non-interactive).
//  - The PS script Add-Type's the user32 functions ONCE, then loops in request/response
//    mode: it blocks on a line from stdin, and for each line it received it prints the
//    foreground process name to stdout and flushes.
//  - The Node side controls cadence: call poll() to send a request; the answer arrives
//    asynchronously via the onForeground(processName) callback (one request -> one line).
//
// No native modules, no extra npm deps, no visible windows/console.

const { spawn } = require('child_process');
const readline = require('readline');

// PowerShell script. Receives one line per request on stdin, replies with one line
// (the foreground process name, lowercased, no extension) per request.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$sig = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
'@
Add-Type -MemberDefinition $sig -Name U -Namespace Fg
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $h = [Fg.U]::GetForegroundWindow()
  $procId = 0
  [void][Fg.U]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  if ($procId -gt 0) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) { $name = $p.ProcessName }
  }
  [Console]::Out.WriteLine($name.ToLower())
  [Console]::Out.Flush()
}
`;

let child = null;
let rl = null;
let onForegroundCb = null;

function encodeCommand(script) {
  // PowerShell -EncodedCommand expects base64 of UTF-16LE.
  return Buffer.from(script, 'utf16le').toString('base64');
}

function startMonitor(onForeground) {
  if (child) return;
  onForegroundCb = onForeground;

  const encoded = encodeCommand(PS_SCRIPT);
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
  );
  child = proc;

  rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    if (typeof onForegroundCb === 'function') {
      onForegroundCb((line || '').trim());
    }
  });

  proc.on('error', (err) => {
    console.error('game-monitor: failed to start helper:', err.message);
  });
  proc.on('exit', (code) => {
    console.log('game-monitor: helper exited with code', code);
    // Only clear state if this is still the active process — a restart may
    // have already spawned a replacement, and the old exit must not null it.
    if (child === proc) {
      child = null;
      rl = null;
    }
  });
}

// Request a single foreground reading. The answer arrives via onForeground callback.
function poll() {
  if (child && child.stdin.writable) {
    child.stdin.write('\n');
  }
}

function stopMonitor() {
  if (rl) {
    rl.close();
    rl = null;
  }
  if (child) {
    try { child.stdin.end(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    child = null;
  }
  onForegroundCb = null;
}

module.exports = { startMonitor, poll, stopMonitor };
