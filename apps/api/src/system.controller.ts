import { Controller, Get } from '@nestjs/common';
import { openApiDocument } from './contracts/openapi.generated';

@Controller()
export class SystemController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'api',
      uptime_seconds: process.uptime(),
    };
  }

  @Get('openapi.json')
  openApi() {
    return openApiDocument;
  }
}
