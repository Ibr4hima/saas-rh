import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { porteDesCorps } from './common/corps';
import { Limiteur } from './common/limiteur';
import { pourLeJournal, ProblemFilter } from './common/problem';
import { controleDOrigine, entetesDeSecurite, originesAutorisees } from './common/securite';
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
  const express = app.getHttpAdapter().getInstance() as import('express').Express;
  // Le serveur ne dit pas ce qu'il est.
  express.disable('x-powered-by');
  // Les en-têtes de sécurité d'abord : même un refus les porte.
  app.use(entetesDeSecurite(env));
  // Derrière un reverse proxy, req.ip doit être l'adresse du client (anti-abus).
  if (env.TRUST_PROXY !== undefined) {
    express.set('trust proxy', env.TRUST_PROXY);
  }
  // Avant la porte des corps : un envoi qu'elle refuse garde ses en-têtes
  // CORS, et le navigateur lit la raison au lieu d'une erreur réseau.
  const origines = originesAutorisees(env);
  app.enableCors({ origin: origines, credentials: true, maxAge: 600 });
  // Un geste venu d'un autre site s'arrête ici, avant toute lecture.
  app.use(controleDOrigine(origines));
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

  await app.listen(env.PORT);
  // Node coupe à cinq minutes toute requête dont le corps n'est pas arrivé en
  // entier : la vidéo d'une leçon, 1,3 Go à 4 Mo/s, n'arrivait jamais. Ce
  // délai se tient désormais route par route, dans la porte des corps ; les
  // en-têtes gardent le leur, une minute (ADR-0069).
  (app.getHttpServer() as Server).requestTimeout = 0;
  console.log(`API Teranga RH démarrée sur http://localhost:${env.PORT}/v1/health`);
  arreterProprement(app);
}

/** Le temps laissé aux requêtes en cours quand l'arrêt est demandé. */
const GRACE_MS = 25_000;

/**
 * L'arrêt (déploiement, redémarrage) sans couper personne (ADR-0067) : le
 * serveur ne prend plus de nouvelle requête, celles en cours finissent
 * (vingt-cinq secondes au plus), puis les tâches de fond s'arrêtent et les
 * connexions à la base se ferment. Avant, la base se fermait d'abord et les
 * requêtes encore en vol échouaient.
 */
function arreterProprement(app: INestApplication): void {
  const serveur = app.getHttpServer() as Server;
  let enCours = false;
  const arreter = async (signal: string): Promise<void> => {
    if (enCours) return;
    enCours = true;
    console.log(`Arrêt demandé (${signal}) : les requêtes en cours finissent.`);
    await new Promise<void>((fin) => {
      serveur.close(() => fin());
      setTimeout(fin, GRACE_MS).unref();
    });
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void arreter('SIGTERM'));
  process.on('SIGINT', () => void arreter('SIGINT'));
}

// Une promesse rejetée que personne n'attend (une tâche de fond, un minuteur)
// est consignée : elle n'arrête pas le processus, et avec lui toutes les
// requêtes en cours.
process.on('unhandledRejection', (raison) => {
  console.error('Promesse rejetée sans gestionnaire :', pourLeJournal(raison));
});

void bootstrap();
