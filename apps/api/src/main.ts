import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { porteDesCorps } from './common/corps';
import { Limiteur } from './common/limiteur';
import { ProblemFilter } from './common/problem';
import { loadEnv } from './config/env';
import { SESSION_COOKIE } from './modules/auth/auth.constants';
import { AuthService } from './modules/auth/auth.service';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    bodyParser: false,
  });

  app.setGlobalPrefix('v1');
  // Derrière un reverse proxy, req.ip doit être l'adresse du client (anti-abus).
  if (env.TRUST_PROXY !== undefined) {
    (app.getHttpAdapter().getInstance() as import('express').Express).set(
      'trust proxy',
      env.TRUST_PROXY,
    );
  }
  // Avant la porte des corps : un envoi qu'elle refuse garde ses en-têtes
  // CORS, et le navigateur lit la raison au lieu d'une erreur réseau.
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true,
  });
  // Le cookie d'abord : la porte des corps reconnaît la session avant de
  // lire un fichier. Chaque route qui reçoit un fichier y est décrite, avec
  // sa taille et qui peut l'emprunter (cf. common/corps.ts) ; ailleurs, un
  // JSON d'un mégaoctet au plus. La vidéo d'une leçon n'est lue par aucun
  // analyseur : elle descend en flux jusqu'au disque, après les gardes.
  app.use(cookieParser());
  const auth = app.get(AuthService);
  app.use(
    porteDesCorps({
      limiteur: app.get(Limiteur),
      session: (jeton) => auth.resolveSession(jeton),
      cookie: SESSION_COOKIE,
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(`API Teranga RH démarrée sur http://localhost:${env.PORT}/v1/health`);
}

void bootstrap();
