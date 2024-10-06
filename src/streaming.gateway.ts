import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Worker } from 'worker_threads';
import { join } from 'path';

interface FFmpegWorkerData {
  worker: Worker;
  dataBuffer: Buffer[];
  batchTimeout?: NodeJS.Timeout;
  canSend: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class StreamingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private workers: Map<string, FFmpegWorkerData> = new Map();

  // Batch processing configuration
  private readonly BATCH_TIMEOUT = 100; // ms
  private readonly MAX_BATCH_SIZE = 1024 * 1024; // 1MB

  handleConnection(client: Socket) {
    client.emit('message', 'Hello from mediarecorder-to-rtmp server!');
    client.emit(
      'message',
      'Please set rtmp destination before start streaming.',
    );
  }

  handleDisconnect(client: Socket) {
    this.stopFFmpeg(client);
  }

  @SubscribeMessage('config_rtmpDestination')
  handleConfigRtmpDestination(client: Socket, destination: string): void {
    if (
      typeof destination !== 'string' ||
      !/^rtmps:\/\/[^\s]*$/.test(destination)
    ) {
      client.emit('fatal', 'Invalid RTMP destination.');
      return;
    }
    client['_rtmpDestination'] = destination;
    client.emit('message', `RTMP destination set to: ${destination}`);
  }

  @SubscribeMessage('start')
  handleStart(client: Socket): void {
    if (this.workers.has(client.id)) {
      client.emit('fatal', 'Stream already started.');
      return;
    }

    if (!client['_rtmpDestination']) {
      client.emit('fatal', 'No destination given.');
      return;
    }

    const ffmpegOptions = this.getFfmpegOptions(
      client.handshake.query.framespersecond,
      parseInt(client.handshake.query.audioBitrate as string),
      client['_rtmpDestination'],
    );

    try {
      const worker = new Worker(join(__dirname, 'ffmpeg.worker.js'));

      worker.on('message', (message) =>
        this.handleWorkerMessage(client, message),
      );
      worker.on('error', (error) => {
        console.error('Worker error:', error);
        client.emit('fatal', 'FFmpeg worker error');
        this.stopFFmpeg(client);
      });

      this.workers.set(client.id, {
        worker,
        dataBuffer: [],
        canSend: true,
      });

      worker.postMessage({ type: 'start', options: ffmpegOptions });
    } catch (error) {
      client.emit('fatal', 'Could not start FFmpeg process');
    }
  }

  @SubscribeMessage('binarystream')
  handleBinaryStream(client: Socket, data: Buffer): void {
    const workerData = this.workers.get(client.id);
    if (!workerData) {
      client.emit('fatal', 'Stream not started.');
      return;
    }

    workerData.dataBuffer.push(data);

    // If this is the first chunk in the buffer, start the timeout
    if (workerData.dataBuffer.length === 1 && workerData.canSend) {
      workerData.batchTimeout = setTimeout(() => {
        this.processBatch(client.id);
      }, this.BATCH_TIMEOUT);
    }

    // If we've exceeded MAX_BATCH_SIZE, process immediately
    if (
      this.getCurrentBatchSize(workerData.dataBuffer) >= this.MAX_BATCH_SIZE &&
      workerData.canSend
    ) {
      clearTimeout(workerData.batchTimeout);
      this.processBatch(client.id);
    }
  }

  private handleWorkerMessage(client: Socket, message: any): void {
    const workerData = this.workers.get(client.id);
    if (!workerData) return;

    switch (message.type) {
      case 'stderr':
        client.emit('ffmpeg_stderr', message.data);
        break;
      case 'error':
        client.emit('fatal', 'FFmpeg error: ' + message.error);
        this.stopFFmpeg(client);
        break;
      case 'exit':
        client.emit('fatal', 'FFmpeg process exited with code ' + message.code);
        this.stopFFmpeg(client);
        break;
      case 'backpressure':
        workerData.canSend = false;
        break;
      case 'ready':
        workerData.canSend = true;
        this.processBatch(client.id);
        break;
    }
  }

  private processBatch(clientId: string): void {
    const workerData = this.workers.get(clientId);
    if (
      !workerData ||
      workerData.dataBuffer.length === 0 ||
      !workerData.canSend
    )
      return;

    const batchedData = Buffer.concat(workerData.dataBuffer);
    workerData.dataBuffer = [];
    workerData.worker.postMessage({ type: 'data', data: batchedData }, [
      batchedData.buffer,
    ]);
  }

  private getCurrentBatchSize(dataBuffer: Buffer[]): number {
    return dataBuffer.reduce((total, buffer) => total + buffer.length, 0);
  }

  private stopFFmpeg(client: Socket): void {
    const workerData = this.workers.get(client.id);
    if (workerData) {
      clearTimeout(workerData.batchTimeout);
      workerData.worker.postMessage({ type: 'stop' });
      workerData.worker.once('message', (message) => {
        if (message.type === 'stopped') {
          workerData.worker.terminate();
          this.workers.delete(client.id);
        }
      });
    }
  }

  private getFfmpegOptions(
    framerate: any,
    audioBitrate: number,
    destination: string,
  ): string[] {
    const baseOptions = [
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-c:a',
      'aac',
      '-ar',
      audioBitrate.toString(),
      '-b:a',
      this.getAudioEncoding(audioBitrate),
      '-bufsize',
      '5000',
      '-f',
      'flv',
      destination,
    ];

    if (framerate === 1) {
      return [
        ...baseOptions.slice(0, 6),
        '-r',
        '1',
        '-g',
        '2',
        '-keyint_min',
        '2',
        '-x264opts',
        'keyint=2',
        '-crf',
        '25',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'baseline',
        '-level',
        '3',
        ...baseOptions.slice(6),
      ];
    }

    if (framerate === 15) {
      return [
        ...baseOptions.slice(0, 6),
        '-max_muxing_queue_size',
        '1000',
        '-r',
        '15',
        '-g',
        '30',
        '-keyint_min',
        '30',
        '-x264opts',
        'keyint=30',
        '-crf',
        '25',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'baseline',
        '-level',
        '3',
        ...baseOptions.slice(6),
      ];
    }

    return baseOptions;
  }

  private getAudioEncoding(audioBitrate: number): string {
    const bitrateMap: Record<number, string> = {
      11025: '11k',
      22050: '22k',
      44100: '44k',
    };
    return bitrateMap[audioBitrate] || '64k';
  }
}
