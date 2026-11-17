/**
 * Settings → שרת: restart or redeploy the app from the UI instead of from a shell on the VM.
 *
 * The container cannot restart itself — that needs the Docker daemon on the host, and handing the
 * app the Docker socket would hand it root on the VM. So this does what the campaign advisor does
 * (agentClient.ts): it opens an SSH session to the host with a key that runs **one fixed command**,
 * `deploy/ops.sh`, which knows four requests — status, logs, restart, redeploy — and nothing else.
 *
 * Nothing here is typed in a form. `deploy/setup-ops.sh` generates the key on the VM and writes it,
 * with the host key to pin, into a folder docker-compose.yml mounts read-only at /run/am-ops.
 */
import ssh2 from 'ssh2';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const { Client } = ssh2;

export class OpsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export type OpsRequest = 'status' | 'logs' | 'restart' | 'redeploy';

const STARTED_AT = new Date().toISOString();

function config() {
  const dir = process.env.OPS_SSH_DIR || '/run/am-ops';
  const keyPath = join(dir, 'id_ed25519');
  const hostKeyPath = join(dir, 'host_key');
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '');
  let key = '';
  let hostKey = '';
  let readError = '';
  try {
    key = read(keyPath);
    hostKey = read(hostKeyPath);
  } catch (err) {
    readError = (err as Error).message;
  }
  return {
    dir,
    host: process.env.OPS_SSH_HOST || 'host.docker.internal',
    port: parseInt(process.env.OPS_SSH_PORT || '22', 10) || 22,
    user: process.env.OPS_SSH_USER || 'amops',
    key: key ? `${key}\n` : '',
    // `ssh-ed25519 AAAA…` — only the base64 body is compared, as in agentClient.ts.
    hostKeys: hostKey.split(/\s+/).filter((t) => t.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(t)),
    readError,
  };
}

export function opsConfigured(): boolean {
  const c = config();
  return Boolean(c.key && c.hostKeys.length);
}

/** Runs one request on the host and returns what it printed. Non-zero exit is an OpsError. */
export function runOps(request: OpsRequest, timeoutMs = 30_000): Promise<string> {
  const c = config();
  if (c.readError) throw new OpsError(`לא ניתן לקרוא את מפתח השרת (${c.dir}): ${c.readError}`, 503);
  if (!c.key) throw new OpsError('ניהול השרת לא הוגדר — הריצו על השרת: sudo deploy/setup-ops.sh', 503);
  if (!c.hostKeys.length) throw new OpsError(`חסר מפתח המארח ב-${c.dir}/host_key — הריצו שוב את setup-ops.sh`, 503);

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err: Error | null, out?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      conn.destroy();
      if (err) reject(err);
      else resolve(out!);
    };
    const timer = setTimeout(() => finish(new OpsError('השרת לא השיב בזמן', 504)), timeoutMs);

    conn.on('ready', () => {
      // The request is one of four fixed words; ops.sh matches it and never executes it.
      conn.exec(request, (err, stream) => {
        if (err) return finish(new OpsError(`הרצת הפקודה נכשלה: ${err.message}`));
        stream
          .on('close', (code: number) => {
            if (Number(code)) {
              const msg = (stderr.trim() || stdout.trim()).replace(/^am-ops:\s*/, '');
              finish(new OpsError(msg || `קוד יציאה ${code}`, /already running/.test(msg) ? 409 : 502));
            } else finish(null, stdout);
          })
          .on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); })
          .stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
        stream.end();
      });
    });
    conn.on('error', (err: Error) => {
      const mismatch = /handshake|host.?key|verification/i.test(err.message);
      finish(new OpsError(
        mismatch
          ? `אימות השרת נכשל — מפתח המארח אינו תואם (${err.message}). הריצו שוב את setup-ops.sh`
          : `החיבור לשרת נכשל: ${err.message}`,
        mismatch ? 502 : 503,
      ));
    });
    conn.connect({
      host: c.host,
      port: c.port,
      username: c.user,
      privateKey: c.key,
      readyTimeout: 15_000,
      hostVerifier: (key: Buffer) => c.hostKeys.includes(key.toString('base64')),
    });
  });
}

export interface OpsStatus {
  running: boolean;
  action: string;
  started: string;
  finished: string;
  exit: number | null;
  commit: string;
  branch: string;
  subject: string;
  log: string;
}

/** `key=value` lines, `---`, then the tail of the last job's log — see print_status in ops.sh. */
export function parseStatus(out: string): OpsStatus {
  const [head, ...rest] = out.split(/^---$/m);
  const fields: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    running: fields.running === '1',
    action: fields.action || '',
    started: fields.started || '',
    finished: fields.finished || '',
    exit: fields.exit === undefined || fields.exit === '' ? null : Number(fields.exit),
    commit: fields.commit || '',
    branch: fields.branch || '',
    subject: fields.subject || '',
    log: rest.join('---').replace(/^\n/, ''),
  };
}

/** What this process is: the build it came from and when it started. Also served by /api/health. */
export function appIdentity() {
  return { version: process.env.APP_VERSION || '', started_at: STARTED_AT };
}
