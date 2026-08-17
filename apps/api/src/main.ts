import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  app.setGlobalPrefix('v1');
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({ origin: ['http://localhost:3000'], credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(`API Teranga RH démarrée sur http://localhost:${env.PORT}/v1/health`);
}

void bootstrap();
