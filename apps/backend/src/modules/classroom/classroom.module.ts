/**
 * ClassroomModule — creation, lookup, membership, and admin settings for
 * classrooms (SPEC.md §7, §12).
 *
 * Owns: classrooms, memberships (both from 001_initial_schema.sql). Reads
 * personas (to decide the teacher-vs-student default role on join) — same
 * pragmatic cross-module read pattern already established by auth/
 * identity/institution.
 *
 * Imports AuthModule solely for JwtAuthGuard — every route except the
 * public classroom-lookup endpoint requires a full session.
 */

import { Module } from '@nestjs/common';
import { ClassroomService } from './classroom.service';
import { ClassroomController } from './classroom.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ClassroomController],
  providers: [ClassroomService],
  exports: [ClassroomService],
})
export class ClassroomModule {}
