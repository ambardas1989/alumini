/**
 * NestJS application entry point.
 *
 * Configures:
 * - Global prefix /v1
 * - Helmet (security headers)
 * - Compression
 * - CORS (whitelist from environment)
 * - Validation pipe (class-validator)
 * - Swagger docs (development only)
 * - Global exception filter
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLogger } from './common/logger/logger.service';
import { brand } from '@alumini/config/brand';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // TASKS_05 TASK 11 — routes Nest's OWN internal logging (route
  // registration, lifecycle events, etc.) through AppLogger too, so
  // LOG_LEVEL governs the framework's own noise, not just this app's own
  // service-level logs. AppLogger is TRANSIENT-scoped (see its own doc
  // comment on why, a deviation from the task's plain @Injectable()) —
  // `strict: false` resolves a single instance from the root module for
  // this one bootstrap-level use, same as Nest's own docs show for
  // getting a transient provider outside constructor injection.
  const appLogger = app.get(AppLogger, { strict: false });
  app.useLogger({
    log: (message) => appLogger.info(message),
    error: (message, trace) => appLogger.error(message, trace ? { trace } : undefined),
    warn: (message) => appLogger.warn(message),
    debug: (message) => appLogger.debug(message),
    verbose: (message) => appLogger.debug(message),
  });

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet());
  app.use(compression());

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Always-allowed frontend origins, plus whatever CORS_ORIGINS adds on top
  // (comma-separated, e.g. a production custom domain). '*' in an entry
  // matches any subdomain segment(s) — needed for Cloudflare Pages/Render's
  // per-deploy preview URLs, which don't have a fixed hostname to whitelist.
  //
  // FIX 1: the production domains (alumtribe.com/www/.app) were missing
  // from this default list entirely — they only ever got through via the
  // CORS_ORIGINS env var, so any deploy where that var wasn't set had every
  // credentialed request from the real production site rejected by CORS,
  // including AuthProvider's/SessionExpiryWarning's silent-refresh calls —
  // a refresh blocked by CORS looks identical to a genuinely expired
  // session to those components, which is the likely real cause of users
  // seeing "session expired" while their session was actually fine (see
  // FIX 6's own investigation note in auth/login/page.tsx). Now hardcoded
  // here as a default, not solely dependent on ops remembering to set the
  // env var. Kept the dynamic origin-matching function (wildcard support
  // for Cloudflare Pages/Render previews) rather than replacing it with a
  // fixed array — a static list would silently break every preview deploy.
  const DEFAULT_ALLOWED_ORIGINS = [
    'https://alumtribe.com',
    'https://www.alumtribe.com',
    'https://alumtribe.app',
    'http://localhost:3000', // local Next.js dev
    'http://localhost:3001', // local Next.js dev (alternate port)
    'http://localhost:19006', // local Expo web
    'https://*.pages.dev', // Cloudflare Pages preview URLs
    'https://*.onrender.com', // Render preview URLs
  ];

  const envOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const allowedOrigins = [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins];

  const originMatches = (origin: string, pattern: string): boolean => {
    if (!pattern.includes('*')) return origin === pattern;

    const regex = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+');
    return new RegExp(`^${regex}$`).test(origin);
  };

  app.enableCors({
    origin: (origin, callback) => {
      // No Origin header (server-to-server calls, curl, native mobile
      // clients) isn't a browser cross-origin request — nothing to check.
      if (!origin || allowedOrigins.some((pattern) => originMatches(origin, pattern))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dev-Key', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // ── Global prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('v1');

  // ── Validation pipe ───────────────────────────────────────────────────────
  // Strips unknown properties, validates DTO shapes, throws on invalid input
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw on unknown properties
      transform: true,           // Auto-transform to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Global exception filter ───────────────────────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── Swagger docs (dev only) ───────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle(`${brand.name} API`)
      .setDescription(`${brand.name} REST API — development documentation`)
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log(`Swagger docs available at http://localhost:${process.env.PORT ?? 3001}/docs`);
  }

  // ── Start server ──────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  logger.log(`${brand.name} API running on port ${port} [${process.env.NODE_ENV}]`);
}

bootstrap();
