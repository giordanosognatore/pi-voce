import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { acquireAudioLock } from "./audio-lock.ts";

interface Playback { child?: ChildProcessWithoutNullStreams; done: Promise<void> }

export class SpeechPlayer {
  private current?: Playback;
  private generation = 0;
  private lockPath: string;
  private onState: (voice: string | undefined, rate?: number) => void;
  constructor(lockPath: string, onState: (voice: string | undefined, rate?: number) => void = () => {}) {
    this.lockPath = lockPath;
    this.onState = onState;
  }

  private async stopCurrent() {
    const current = this.current;
    if (!current) return;
    if (current.child && !current.child.killed) current.child.kill();
    const timeout = setTimeout(() => { current.child?.kill("SIGKILL"); }, 1500);
    timeout.unref();
    try { await current.done; } finally { clearTimeout(timeout); }
  }

  async stop() {
    this.generation++;
    await this.stopCurrent();
  }

  // One lease for the whole reading, one say process per paragraph. A paragraph
  // is completed only after a successful close, never merely after stdin drains.
  // Return after startup: neither commands nor agent_settled wait for the audio.
  async play(text: string | readonly string[], voice: string, rate: number, notify: (message: string) => void, onProgress?: (completed: number) => void) {
    const generation = ++this.generation;
    await this.stopCurrent();
    const paragraphs = (typeof text === "string" ? [text] : [...text]).filter((part) => part.trim());
    if (generation !== this.generation || !paragraphs.length) return false;
    const lease = acquireAudioLock(this.lockPath);
    if (!lease) {
      notify("Audio occupato da un'altra sessione Pi. Lettura non avviata; riprova con /voce o /voce riprendi quando ha finito.");
      return false;
    }
    let resolve!: () => void;
    const playback: Playback = { done: new Promise<void>((done) => { resolve = done; }) };
    this.current = playback;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      lease.release();
      if (this.current === playback) {
        this.current = undefined;
        this.onState(undefined);
      }
      resolve();
    };
    const start = (index: number) => {
      const child = spawn("/usr/bin/say", ["-v", voice, "-r", String(rate)], { stdio: ["pipe", "pipe", "pipe"] });
      playback.child = child;
      let error = "";
      let failed = false;
      child.stdout.resume();
      child.stderr.on("data", (data) => { error = (error + String(data)).slice(0, 2000); });
      child.stdin.on("error", () => {});
      child.on("error", (err) => { failed = true; notify(`Lettura vocale: ${err.message}`); });
      child.once("close", (code, signal) => {
        playback.child = undefined;
        if (!failed && !signal && code === 0 && !child.killed && generation === this.generation) {
          onProgress?.(index + 1);
          if (index + 1 < paragraphs.length) {
            try { start(index + 1); }
            catch (err) {
              const cleanup = playback.child ? this.stop() : Promise.resolve(finish());
              void cleanup.then(() => notify(`Lettura vocale: ${err instanceof Error ? err.message : String(err)}`));
            }
          } else finish();
        } else {
          finish();
          if (!failed && !signal && code !== 0 && !child.killed) notify(`Lettura vocale: ${error.trim() || `say è terminato con codice ${code}`}`);
        }
      });
      if (child.pid) lease.setPlayer(child.pid);
      if (index === 0) onProgress?.(0);
      child.stdin.end(paragraphs[index]);
      this.onState(voice, rate);
    };
    try {
      start(0);
      return true;
    } catch (error) {
      // Metadata/stdin failure after spawn must still close our process before
      // releasing the lease. A synchronous spawn failure has no child to stop.
      if (playback.child) await this.stop(); else finish();
      throw error;
    }
  }
}
