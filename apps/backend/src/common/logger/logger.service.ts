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
 * BUG FIX (Render deploy failure — "AppLogger is marked as a scoped
 * provider. Request and transient-scoped providers can't be used in
 * combination with get() method."): this was `@Injectable({ scope:
 * Scope.TRANSIENT })` so each injecting service got its own instance and
 * setContext() calls couldn't stomp each other — but main.ts's
 * `app.get(AppLogger)` (needed to route Nest's own framework logging
 * through this class) can NEVER resolve a request/transient-scoped
 * provider, `strict: false` or not; that's a hard NestJS limitation, not
 * something a resolution option works around. Reverted to the default
 * singleton scope this class needs to support app.get() at all.
 *
 * BUG FIX (confirmed in production): setContext() used to mutate
 * `this.context` on the one shared singleton instance every service
 * injects. Whichever service's constructor ran last during Nest's
 * dependency graph setup silently "won" that context for every other
 * service's subsequent logs, permanently, for the process's life —
 * production logs showed EVERY AuthService line ("Login success", "MFA
 * setup initiated", "MFA verify failed", ...) tagged [CORRIDOR], because
 * CorridorService's constructor happened to run after AuthService's.
 * setContext() now returns a NEW child instance instead of mutating
 * shared state — every constructor that calls it must store the
 * RETURNED value in its own field (`this.appLogger = appLogger.setContext(...)`),
 * not rely on the injected singleton parameter being mutated in place.
 */

import { Injectable } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];

@Injectable()
export class AppLogger {
  private context?: string;
  private readonly level: LogLevel;

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  /** Returns a NEW logger carrying this context — see the class doc comment on why this can't mutate `this` in place. */
  setContext(context: string): AppLogger {
    const child = new AppLogger();
    child.context = context;
    return child;
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
