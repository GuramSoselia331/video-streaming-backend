import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { spawn, ChildProcess } from 'child_process';

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

  private ffmpegProcesses: Map<
    string,
    { process: ChildProcess; feedStream: boolean }
  > = new Map();

  handleConnection(client: Socket) {
    client.emit('message', 'Hello from mediarecorder-to-rtmp server!');
    client.emit(
      'message',
      'Please set rtmp destination before start streaming.',
    );
  }

  handleDisconnect(client: Socket) {
    console.log('socket disconnected!');
    this.stopFFmpeg(client);
  }

  @SubscribeMessage('config_vcodec')
  handleConfigVcodec(client: Socket, codec: string): void {
    if (typeof codec !== 'string' || !/^[0-9a-z]{2,}$/.test(codec)) {
      client.emit('fatal', 'input codec setup error.');
      return;
    }
    client['_vcodec'] = codec;
  }

  @SubscribeMessage('config_rtmpDestination')
  handleConfigRtmpDestination(client: Socket, destination: string): void {
    if (typeof destination !== 'string') {
      client.emit('fatal', 'rtmp destination setup error.');
      return;
    }

    const regexValidator = /^rtmp:\/\/[^\s]*$/;
    if (!regexValidator.test(destination)) {
      client.emit('fatal', 'rtmp address rejected.');
      return;
    }

    client['_rtmpDestination'] = destination;
    client.emit('message', `rtmp destination set to: ${destination}`);
  }

  @SubscribeMessage('start')
  handleStart(client: Socket): void {
    if (this.ffmpegProcesses.has(client.id)) {
      client.emit('fatal', 'stream already started.');
      return;
    }

    if (!client['_rtmpDestination']) {
      client.emit('fatal', 'no destination given.');
      return;
    }

    const framerate = client.handshake.query.framespersecond;
    const audioBitrate = parseInt(
      client.handshake.query.audioBitrate as string,
    );
    const audioEncoding = this.getAudioEncoding(audioBitrate);

    const ffmpegOptions = this.getFfmpegOptions(
      framerate,
      audioBitrate,
      audioEncoding,
      client['_rtmpDestination'],
    );

    try {
      const ffmpegProcess = spawn('ffmpeg', ffmpegOptions);

      ffmpegProcess.stderr.on('data', (data) => {
        client.emit('ffmpeg_stderr', '' + data);
      });

      ffmpegProcess.on('error', (error) => {
        console.log('child process error', error);
        client.emit('fatal', 'ffmpeg error!' + error);
        this.stopFFmpeg(client);
      });

      ffmpegProcess.on('exit', (code) => {
        console.log('child process exit', code);
        client.emit('fatal', 'ffmpeg exit!' + code);
        this.stopFFmpeg(client);
      });

      this.ffmpegProcesses.set(client.id, {
        process: ffmpegProcess,
        feedStream: true,
      });
    } catch (error) {
      client.emit('fatal', 'Could not start FFmpeg process');
      this.stopFFmpeg(client);
    }
  }

  @SubscribeMessage('binarystream')
  handleBinaryStream(client: Socket, data: any): void {
    const ffmpegData = this.ffmpegProcesses.get(client.id);
    if (!ffmpegData || !ffmpegData.feedStream) {
      client.emit('fatal', 'rtmp not set yet.');
      this.stopFFmpeg(client);
      return;
    }
    ffmpegData.process.stdin.write(data);
  }

  private stopFFmpeg(client: Socket): void {
    const ffmpegData = this.ffmpegProcesses.get(client.id);
    if (ffmpegData) {
      try {
        ffmpegData.process.stdin.end();
        ffmpegData.process.kill('SIGINT');
        console.log('ffmpeg process ended!');
      } catch (e) {
        console.warn('killing ffmpeg process attempt failed...', e);
      }
      this.ffmpegProcesses.delete(client.id);
    }
  }

  private getAudioEncoding(audioBitrate: number): string {
    if (audioBitrate === 11025) return '11k';
    if (audioBitrate === 22050) return '22k';
    if (audioBitrate === 44100) return '44k';
    return '64k';
  }

  private getFfmpegOptions(
    framerate: any,
    audioBitrate: number,
    audioEncoding: string,
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
      audioEncoding,
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
    } else if (framerate === 15) {
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
}
