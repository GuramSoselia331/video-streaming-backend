import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StreamingGateway } from './streaming.gateway';
@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, StreamingGateway],
})
export class AppModule {
  constructor() {}
}
