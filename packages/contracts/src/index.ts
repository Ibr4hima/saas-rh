/**
 * Contrats partagés API <-> clients (web, PWA).
 * Source unique des types côté client — toute évolution est additive dans /v1 (ADR-0006).
 *
 * Simple barrière de réexport : aucune définition ici, pour qu'aucun module
 * du paquet n'ait de raison d'importer « ./index » et de recréer un cycle.
 */
export * from './core';
export * from './dashboard';
export * from './employees';
export * from './absences';
export * from './portal';
export * from './recruitment';
export * from './documents';
export * from './document-requests';
export * from './nationalities';
export * from './profile-changes';
