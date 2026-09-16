import { spawn } from 'node:child_process';

/**
 * Pipe raw RGBA frames straight into ffmpeg. No intermediate PNGs, and the
 * output frame rate is exact regardless of how slowly we render.
 */
export function openEncoder({ width, height, fps, out, crf = 21 }) {
  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-pix_fmt', 'yuv420p',        // required, or some clients show a black video
    '-movflags', '+faststart',
    '-profile:v', 'high', '-level', '4.2',
    out,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  let failed = null;
  ff.on('error', (e) => { failed = e; });

  return {
    write(buf) {
      if (failed) throw failed;
      // Respect backpressure, or a long render balloons memory.
      return ff.stdin.write(buf) ? Promise.resolve() : new Promise((r) => ff.stdin.once('drain', r));
    },
    close() {
      return new Promise((res, rej) => {
        ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
        ff.stdin.end();
      });
    },
  };
}
