/**
 * SSH transport to the AI agent — how the campaign advisor asks a question and gets an answer.
 *
 * Deliberately *not* an HTTP API client. The agent runs as a command-line tool on another
 * machine, already logged in there, and this opens an SSH session to run it. What that buys is
 * the credential: the app holds an SSH key that opens exactly one command, and the AI account's
 * own credentials never exist in this container, in the database, or in any error that reaches a
 * browser. An API key would have to live here; a key to somebody else's shell does not.
 *
 * Two properties matter more than anything else in this file:
 *
 *  1. **The prompt goes down stdin, never into the command line.** The command is fixed by the
 *     server's configuration and is never assembled from a request. The
 *     n8n templates in `.claude/skills/invoice-expert/` do `echo "{{ text }}" | claude …`,
 *     which hands anything that reaches that text a shell — this must not repeat it.
 *  2. **The host key is pinned.** `deploy/README.md` refuses `StrictHostKeyChecking=no` for the
 *     deploy key for the same reason: without a pin, whoever answers the address gets the key.
 */

// ssh2 is CommonJS and its exports are built at runtime, so Node's ESM loader cannot see them as
// named exports — `import { Client } from 'ssh2'` typechecks and then fails on boot. The default
// import is the interop that actually works.
import ssh2 from 'ssh2';
import type { ConnectConfig } from 'ssh2';

const { Client } = ssh2;
import { getSetting } from './db.js';
import { agentConfig, isAgentConfigured } from './agentConfig.js';

export { isAgentConfigured };

export class AgentError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * The private key, from wherever it is configured.
 *
 * Which place that is — the settings form or `AGENT_SSH_*` — is agentConfig's problem; what
 * matters here is that a key which cannot be read is named as such. A stored key that will not
 * decrypt and a missing one fail very differently to whoever has to fix it.
 */
function privateKey(config = agentConfig()): string {
  if (config.privateKey === null) {
    throw new AgentError(
      'המפתח הפרטי השמור לא ניתן לקריאה — הזינו אותו מחדש בהגדרות → סוכן AI',
      503
    );
  }
  if (!config.privateKey) {
    throw new AgentError('הסוכן לא מוגדר — חסר מפתח SSH (הגדרות → סוכן AI)', 503);
  }
  return config.privateKey;
}

export function agentCommand(): string {
  return agentConfig().command;
}

/**
 * Refuses an unpinned host in production.
 *
 * In development the pin is allowed to be missing — pointing the thing at a stub on localhost to
 * see the plumbing work should not require a keyscan first — but it warns every time, because a
 * dev shortcut that goes quiet is one that ends up in production.
 */
function hostVerifier(config = agentConfig()): ((key: Buffer) => boolean) | undefined {
  const pins = config.hostKeys;
  if (pins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new AgentError('הסוכן לא מוגדר — חסר מפתח המארח (חובה בייצור)', 503);
    }
    console.warn('[agent] no pinned host key — the host is not verified. Do not ship this.');
    return undefined;
  }
  return (key: Buffer) => pins.includes(key.toString('base64'));
}

export interface AgentRun {
  stdout: string;
  stderr: string;
  code: number;
  duration_ms: number;
}

/**
 * One run in flight at a time.
 *
 * A run costs an SSH session and a minute or two of somebody else's CPU, and the button that
 * starts one is the kind people press twice. A second caller is told the agent is busy rather
 * than quietly opening a second session.
 */
let inFlight = false;

export function isAgentBusy(): boolean {
  return inFlight;
}

/**
 * Runs the configured command on the agent host with `prompt` on its stdin, and resolves with
 * everything it wrote.
 *
 * A non-zero exit is not thrown here: the advisor wants to see stderr to explain *why* (an
 * expired login and a bad prompt fail very differently), so the caller decides what a failure
 * means.
 */
export async function runAgent(prompt: string, options: { command?: string; timeoutMs?: number } = {}): Promise<AgentRun> {
  // Read once for the whole run: the settings form can be saved while a run is in flight, and a
  // connection assembled from two different versions of the configuration is nobody's.
  const settings = agentConfig();
  if (!settings.host || !settings.user) {
    throw new AgentError('הסוכן לא מוגדר — חסרים פרטי החיבור (הגדרות → סוכן AI)', 503);
  }
  if (inFlight) {
    throw new AgentError('הסוכן עסוק בבקשה אחרת — נסו שוב בעוד רגע', 409);
  }

  const command = options.command || settings.command;
  const limit = options.timeoutMs ?? settings.timeoutMs;
  const key = privateKey(settings);
  const verifier = hostVerifier(settings);
  const started = Date.now();

  const config: ConnectConfig = {
    host: settings.host,
    port: settings.port,
    username: settings.user,
    privateKey: key,
    passphrase: settings.passphrase || undefined,
    // The handshake, not the command: a command may legitimately think for a minute, but a host
    // that has not answered in fifteen seconds is not there.
    readyTimeout: 15_000,
    ...(verifier ? { hostVerifier: verifier } : {}),
  };

  inFlight = true;
  try {
    return await new Promise<AgentRun>((resolve, reject) => {
      const conn = new Client();
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (err: Error | null, run?: AgentRun) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.end();
        conn.destroy();
        if (err) reject(err);
        else resolve(run!);
      };

      const timer = setTimeout(() => {
        finish(new AgentError(`הסוכן לא השיב תוך ${Math.max(1, Math.round(limit / 1000))} שניות`, 504));
      }, limit);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(new AgentError(`הרצת הפקודה על שרת הסוכן נכשלה: ${err.message}`));
          stream
            .on('close', (code: number) => {
              finish(null, {
                stdout,
                stderr,
                code: Number(code) || 0,
                duration_ms: Date.now() - started,
              });
            })
            .on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); })
            .stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

          // The whole prompt, then EOF — the command reads stdin to completion and answers.
          stream.end(prompt);
        });
      });

      conn.on('error', (err: Error & { level?: string }) => {
        // Host-key mismatch surfaces as a handshake error, and it is the one worth naming: it
        // means the address is answering with a key nobody pinned, which is either a rebuilt VM
        // or something that should not be trusted with the key.
        const mismatch = /handshake|host.?key|verification/i.test(err.message);
        finish(new AgentError(
          mismatch
            ? `אימות שרת הסוכן נכשל — מפתח המארח אינו תואם למפתח השמור בהגדרות (${err.message})`
            : `החיבור לשרת הסוכן נכשל: ${err.message}`,
          mismatch ? 502 : 503
        ));
      });

      conn.connect(config);
    });
  } finally {
    inFlight = false;
  }
}

/**
 * Cheap connectivity probe for the Settings card: proves the host answers, the key opens it and
 * the agent command exists, without spending a real analysis on finding out.
 */
export async function ping(): Promise<{ version: string; duration_ms: number }> {
  const base = agentCommand().split(/\s+/)[0];
  const run = await runAgent('', { command: `${base} --version`, timeoutMs: 30_000 });
  if (run.code !== 0) {
    throw new AgentError(`«${base} --version» נכשל על שרת הסוכן: ${run.stderr.trim() || `קוד ${run.code}`}`);
  }
  return { version: run.stdout.trim().slice(0, 200), duration_ms: run.duration_ms };
}

export function agentStatus() {
  const settings = agentConfig();
  return {
    configured: Boolean(settings.host && settings.user && settings.privateKey),
    host: settings.host ? `${settings.user}@${settings.host}${settings.port === 22 ? '' : `:${settings.port}`}` : null,
    command: settings.command,
    host_key_pinned: settings.hostKeys.length > 0,
    timeout_ms: settings.timeoutMs,
    busy: inFlight,
    last_run: getSetting('agent_last_run', '') || null,
    last_error: getSetting('agent_last_error', '') || null,
  };
}
