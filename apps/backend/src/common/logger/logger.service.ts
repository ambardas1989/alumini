/**
 * AppLogger — TASKS_05 TASK 11. Structured, level-gated logging with a
 * consistent timestamp/level/context format and an email-masking helper,
 * so PII never lands in logs unmasked.
 *
 * LOG_LEVEL (env) controls verbosity:
 *   debug — everything, including request-level detail (development)
 *   info  — business events only (production default)
 *   warn  — warnings and errors
 *   error — errors only (incident response)
 *
 * setContext() is per-instance, not per-call — each service that wants a
 * tagged context (e.g. '[AUTH]') calls it once, typically right after
 * injecting AppLogger, same shape as Nest's own Logger.setContext().
 */

import { Injectable, Scope } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];

@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger {
  private context?: string;
  private readonly level: LogLevel;

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  setContext(context: string): this {
    this.context = context;
    return this;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(this.level);
  }

  private format(level: string, message: string, meta?: object): string {
    const ts = new Date().toISOString();
    const ctx = this.context ? `[${this.context}]` : '';
    const m = meta ? ' ' + JSON.stringify(meta) : '';
    return `${ts} ${level.toUpperCase().padEnd(5)} ${ctx} ${message}${m}`;
  }

  debug(message: string, meta?: object) {
    if (this.shouldLog('debug')) console.log(this.format('debug', message, meta));
  }
  info(message: string, meta?: object) {
    if (this.shouldLog('info')) console.log(this.format('info', message, meta));
  }
  warn(message: string, meta?: object) {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, meta));
  }
  error(message: string, meta?: object) {
    if (this.shouldLog('error')) console.error(this.format('error', message, meta));
  }

  /** e.g. test@example.com → te***@example.com. Never log a full email — this is the one sanctioned way to log one at all. */
  static maskEmail(email: string): string {
    const [user, domain] = (email || '').split('@');
    if (!domain || !user) return '***';
    return user.slice(0, 2) + '***@' + domain;
  }
}
