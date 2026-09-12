import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    bodyParser: false,
  });

  app.setGlobalPrefix('v1');
  // Derrière un reverse proxy, req.ip doit refléter le client réel (throttle).
  if (env.TRUST_PROXY !== undefined) {
    (app.getHttpAdapter().getInstance() as import('express').Express).set(
      'trust proxy',
      env.TRUST_PROXY,
    );
  }
  // Corps JSON : SEULE la candidature publique transporte des fichiers en
  // base64 (5 × 5 Mo × 4/3) — la grosse limite est scopée à ce préfixe.
  // Partout ailleurs la limite reste petite : un corps volumineux non
  // authentifié ne doit jamais être bufferisé (revue adverse du lot).
  app.use('/v1/public/jobs', json({ limit: '40mb' }));
  // Justificatifs d'absence (PDF ≤ 5 Mo en base64) — route authentifiée.
  app.use('/v1/absence-requests', json({ limit: '8mb' }));
  // Pièces justificatives du dossier (PDF/images ≤ 5 Mo en base64).
  app.use('/v1/employees', json({ limit: '8mb' }));
  // Le fichier officiel d'un texte de référence arrive en BINAIRE BRUT, pas
  // en base64 : un Journal officiel numérisé pèse plusieurs dizaines de
  // mégaoctets, que le base64 gonflerait d'un tiers avant de les faire passer
  // par `JSON.parse`. Le filtre de type suffit à séparer les deux : les
  // requêtes JSON du même préfixe traversent et tombent sur l'analyseur JSON
  // juste en dessous — le texte structuré d'un code entier y a sa place.
  app.use('/v1/reference-texts', raw({ type: 'application/pdf', limit: '80mb' }));
  app.use('/v1/reference-texts', json({ limit: '8mb' }));
  app.use(json({ limit: '1mb' }));
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(`API Teranga RH démarrée sur http://localhost:${env.PORT}/v1/health`);
}

void bootstrap();
