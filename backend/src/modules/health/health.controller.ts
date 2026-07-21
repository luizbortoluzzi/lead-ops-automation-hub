import { Controller, Get, HttpCode, Logger, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { FastifyReply } from 'fastify';
import { DataSource } from 'typeorm';
import { Public } from '../../common/auth/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @HttpCode(200)
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<{ status: string }> {
    if (!(await this.isDatabaseHealthy())) {
      void reply.status(503);
      return { status: 'error' };
    }
    return { status: 'ok' };
  }

  private async isDatabaseHealthy(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }
}
