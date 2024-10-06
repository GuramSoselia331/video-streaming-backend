import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { spawn } from 'child_process';
import { RedisIoAdapter } from './redis-io.adapter';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  // Check for FFmpeg
  spawn('ffmpeg', ['-h']).on('error', (m) => {
    console.error(
      'FFMpeg not found in system cli; please install ffmpeg properly or make a softlink to ./!',
    );
    process.exit(-1);
  });

  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useWebSocketAdapter(redisIoAdapter);
  // app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({ origin: '*' });
  await app.listen(80, '0.0.0.0');
  console.log('Listening at http://localhost:80');
}
bootstrap();
