import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('create-stream')
  createStream(@Body() body) {
    return this.appService.createStream(body.name);
  }
  @Get('streams')
  getStreams() {
    return this.appService.getStreams();
  }
}
