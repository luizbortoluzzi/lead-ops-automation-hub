import { Global, Module } from '@nestjs/common';
import { CanonicalHashService } from './hashing/canonical-hash.service';
import { SanitizerService } from './sanitization/sanitizer.service';

/** Cross-cutting stateless utilities shared across feature modules. */
@Global()
@Module({
  providers: [CanonicalHashService, SanitizerService],
  exports: [CanonicalHashService, SanitizerService],
})
export class CommonModule {}
