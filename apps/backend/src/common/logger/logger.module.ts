import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';

/**
 * @Global() — registered once in AppModule, injectable into any service
 * afterward without that service's own module importing LoggerModule.
 */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
