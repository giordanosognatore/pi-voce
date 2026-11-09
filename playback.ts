import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { acquireAudioLock } from "./audio-lock.ts";

interface Playback { child: ChildProcessWithoutNullStreams; done: Promise<void> }

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
    if (!current.child.killed) current.child.kill();
    const timeout = setTimeout(() => { current.child.kill("SIGKILL"); }, 1500);
    timeout.unref();
    try { await current.done; } finally { clearTimeout(timeout); }
  }

  async stop() {
    this.generation++;
    await this.stopCurrent();
  }

  async play(text: string, voice: string, rate: number, notify: (message: string) => void) {
    const generation = ++this.generation;
    await this.stopCurrent();
    if (generation !== this.generation || !text.trim()) return false;
    const lease = acquireAudioLock(this.lockPath);
    if (!lease) {
      notify("Audio occupato da un'altra sessione Pi. Lettura non avviata; riprova con /voce quando ha finito.");
      return false;
    }
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn("/usr/bin/say", ["-v", voice, "-r", String(rate)], { stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { lease.release(); throw error; }
    let finish!: () => void;
    const playback = { child, done: new Promise<void>((resolve) => { finish = resolve; }) };
    this.current = playback;
    let error = "";
    let failed = false;
    child.stdout.resume();
    child.stderr.on("data", (data) => { error = (error + String(data)).slice(0, 2000); });
    child.stdin.on("error", () => {});
    child.on("error", (err) => { failed = true; notify(`Lettura vocale: ${err.message}`); });
    child.on("close", (code, signal) => {
      lease.release();
      if (this.current === playback) {
        this.current = undefined;
        this.onState(undefined);
      }
      finish();
      if (!failed && !signal && code !== 0) notify(`Lettura vocale: ${error.trim() || `say è terminato con codice ${code}`}`);
    });
    try {
      if (child.pid) lease.setPlayer(child.pid);
      child.stdin.end(text);
      this.onState(voice, rate);
      return true;
    } catch (error) {
      await this.stopCurrent();
      throw error;
    }
  }
}
