// @ts-ignore
import * as ApiVideoClient from '@api.video/nodejs-client';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  client: ApiVideoClient;
  constructor() {
    this.client = new ApiVideoClient({
      apiKey: 'l7Q3SWNJxAi3nojVwOE688EBFNq9DN2BojdzMImC8AD',
    });
  }
  async createStream(name) {
    try {
      const stream = await this.client.liveStreams.create({ name });
      return stream;
    } catch (e) {
      console.error(e);
    }
  }
  async getStreams() {
    try {
      const streams = await this.client.liveStreams.list();
      return streams;
    } catch (e) {
      console.error(e);
    }
  }
}
