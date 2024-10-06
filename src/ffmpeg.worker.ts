import { parentPort, workerData } from 'worker_threads';
import { spawn, ChildProcess } from 'child_process';

let ffmpegProcess: ChildProcess | null = null;

parentPort?.on('message', (message) => {
  switch (message.type) {
    case 'start':
      startFFmpeg(message.options);
      break;
    case 'data':
      processData(message.data);
      break;
    case 'stop':
      stopFFmpeg();
      break;
  }
});

function startFFmpeg(options: string[]) {
  try {
    ffmpegProcess = spawn('ffmpeg', options);

    ffmpegProcess.stderr?.on('data', (data) => {
      parentPort?.postMessage({ type: 'stderr', data: data.toString() });
    });

    ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg error:', error);
      parentPort?.postMessage({ type: 'error', error: error.message });
    });

    ffmpegProcess.on('exit', (code) => {
      parentPort?.postMessage({ type: 'exit', code });
    });

    parentPort?.postMessage({ type: 'started' });
  } catch (error) {
    console.error(error);
    parentPort?.postMessage({ type: 'error', error: (error as Error).message });
  }
}

function processData(data: Buffer) {
  if (ffmpegProcess && ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
    const canWrite = ffmpegProcess.stdin.write(data);
    if (!canWrite) {
      ffmpegProcess.stdin.once('drain', () => {
        parentPort?.postMessage({ type: 'ready' });
      });
      parentPort?.postMessage({ type: 'backpressure' });
    }
  }
}

function stopFFmpeg() {
  if (ffmpegProcess) {
    try {
      ffmpegProcess.stdin?.end();
      ffmpegProcess.kill('SIGINT');
    } catch (error) {
      console.error('Error stopping FFmpeg:', error);
    } finally {
      ffmpegProcess = null;
      parentPort?.postMessage({ type: 'stopped' });
    }
  }
}

process.on('unhandledRejection', (error) => {
  parentPort?.postMessage({ type: 'error', error: (error as Error).message });
});
