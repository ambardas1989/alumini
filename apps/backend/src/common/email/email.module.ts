import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * @Global() — same pattern as LoggerModule (registered once in
 * AppModule, injectable into any service afterward without that
 * service's own module importing EmailModule).
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
