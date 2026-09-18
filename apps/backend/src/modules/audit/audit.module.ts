import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * AuditModule is marked @Global so AuditService is available
 * in every module without re-importing.
 *
 * Every module that performs auditable actions injects AuditService
 * and calls audit.log() — never writes to audit_logs directly.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
