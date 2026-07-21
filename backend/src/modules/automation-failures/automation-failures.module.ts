import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationFailuresController } from './automation-failures.controller';
import { AutomationFailuresService } from './automation-failures.service';
import { AutomationFailure } from './entities/automation-failure.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AutomationFailure])],
  controllers: [AutomationFailuresController],
  providers: [AutomationFailuresService],
})
export class AutomationFailuresModule {}
