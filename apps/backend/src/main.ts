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
import { brand } from '@alumini/config/brand';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet());
  app.use(compression());

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Always-allowed frontend origins, plus whatever CORS_ORIGINS adds on top
  // (comma-separated, e.g. a production custom domain). '*' in an entry
  // matches any subdomain segment(s) — needed for Cloudflare Pages/Render's
  // per-deploy preview URLs, which don't have a fixed hostname to whitelist.
  const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000', // local Next.js dev
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
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
