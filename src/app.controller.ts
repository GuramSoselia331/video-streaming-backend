import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('create-stream')
  createStream() {
    return this.appService.createStream();
  }
  @Get('streams')
  getStreams() {
    return this.appService.getStreams();
  }
}
