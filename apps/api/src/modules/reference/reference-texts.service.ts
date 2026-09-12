import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ReferenceChapterView,
  ReferenceSearchHit,
  ReferenceTextView,
  SaveReferenceTextInput,
  SessionUser,
  UploadReferencePdfInput,
} from '@teranga/contracts';
import {
  MAX_REFERENCE_PDF_BYTES,
  numeroArticle,
  numeroChapitre,
  numeroSection,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

/**
 * Lire un texte de référence.
 *
 * Un texte de loi se lit par chapitres, pas par pages : on rend donc l'arbre
 * entier en une requête par étage plutôt que de le faire redemander écran par
 * écran. Un code fait quelques centaines d'articles — l'ordre de grandeur d'un
 * tableau, pas d'un flux paginé — et le sommaire, la recherche et les renvois
 * d'un article à l'autre supposent tous de l'avoir en entier.
 *
 * Les octets du PDF, eux, ne partent jamais avec : ils se demandent par leur
 * propre route, quand quelqu'un clique.
 */
@Injectable()
export class ReferenceTextsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  /** Qui dépose et rédige : la RH et l'administration, personne d'autre. */
  private redige(user: SessionUser): boolean {
    return user.role === 'admin' || user.role === 'hr';
  }

  /**
   * Le texte, s'il est visible par cet utilisateur.
   *
   * Tant que `published_at` est nul, le texte est un BROUILLON : il n'existe
   * que pour qui le rédige. Un employé ne doit pas tomber sur un règlement à
   * moitié écrit et le croire en vigueur — et « 404 » plutôt que « 403 », car
   * lui dire qu'un brouillon existe serait déjà en dire trop.
   */
  private async visible(tx: Tx, slug: string, user: SessionUser) {
    const [texte] = await tx
      .select()
      .from(t.referenceTexts)
      .where(eq(t.referenceTexts.slug, slug))
      .limit(1);
    if (!texte || (texte.publishedAt === null && !this.redige(user))) {
      problem(404, 'reference.not_found', 'Ce texte n’a pas encore été déposé');
    }
    return texte;
  }

  /** Les textes disponibles, sans leur contenu : de quoi bâtir un menu. */
  async list(user: SessionUser): Promise<Array<Omit<ReferenceTextView, 'chapters'>>> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const rows = await tx
        .select({
          id: t.referenceTexts.id,
          slug: t.referenceTexts.slug,
          title: t.referenceTexts.title,
          reference: t.referenceTexts.reference,
          effectiveOn: t.referenceTexts.effectiveOn,
          publishedAt: t.referenceTexts.publishedAt,
          pdfFilename: t.referenceTexts.pdfFilename,
          pdfSize: t.referenceTexts.pdfSize,
          // La table est NOMMÉE en toutes lettres, et non interpolée depuis le
          // schéma : sans jointure dans la requête extérieure, Drizzle rend la
          // colonne sans son préfixe — « id » tout court —, et ce nom se
          // résout alors sur `reference_articles`, qui en a un aussi. La
          // sous-requête comparait l'article à lui-même et comptait zéro.
          articleCount: sql<number>`(
            SELECT count(*)::int FROM reference_articles a
            WHERE a.text_id = reference_texts.id)`,
        })
        .from(t.referenceTexts)
        .orderBy(asc(t.referenceTexts.title));

      return rows
        .filter((r) => r.publishedAt !== null || this.redige(user))
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          reference: r.reference,
          effectiveOn: r.effectiveOn,
          published: r.publishedAt !== null,
          pdf: r.pdfFilename ? { filename: r.pdfFilename, size: r.pdfSize ?? 0 } : null,
          articleCount: r.articleCount,
        }));
    });
  }

  /** Le texte entier : chapitres, sections, articles, dans l'ordre. */
  async get(user: SessionUser, slug: string): Promise<ReferenceTextView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const texte = await this.visible(tx, slug, user);

      const chapitres = await tx
        .select({
          id: t.referenceChapters.id,
          number: t.referenceChapters.number,
          title: t.referenceChapters.title,
          body: t.referenceChapters.body,
        })
        .from(t.referenceChapters)
        .where(eq(t.referenceChapters.textId, texte.id))
        .orderBy(asc(t.referenceChapters.number));

      const sections = await tx
        .select({
          id: t.referenceSections.id,
          chapterId: t.referenceSections.chapterId,
          number: t.referenceSections.number,
          title: t.referenceSections.title,
          body: t.referenceSections.body,
        })
        .from(t.referenceSections)
        .innerJoin(t.referenceChapters, eq(t.referenceChapters.id, t.referenceSections.chapterId))
        .where(eq(t.referenceChapters.textId, texte.id))
        .orderBy(asc(t.referenceSections.number));

      const articles = await tx
        .select({
          id: t.referenceArticles.id,
          chapterId: t.referenceArticles.chapterId,
          sectionId: t.referenceArticles.sectionId,
          number: t.referenceArticles.number,
          label: t.referenceArticles.label,
          title: t.referenceArticles.title,
          body: t.referenceArticles.body,
        })
        .from(t.referenceArticles)
        .where(eq(t.referenceArticles.textId, texte.id))
        .orderBy(asc(t.referenceArticles.number));

      const chapters: ReferenceChapterView[] = chapitres.map((c) => ({
        id: c.id,
        numero: numeroChapitre(c.number),
        title: c.title,
        body: c.body,
        sections: sections
          .filter((s) => s.chapterId === c.id)
          .map((s) => ({
            id: s.id,
            numero: numeroSection(s.number),
            title: s.title,
            body: s.body,
          })),
        articles: articles
          .filter((a) => a.chapterId === c.id)
          .map((a) => ({
            id: a.id,
            numero: numeroArticle(a.number, a.label),
            number: a.number,
            sectionId: a.sectionId,
            title: a.title,
            body: a.body,
          })),
      }));

      return {
        id: texte.id,
        slug: texte.slug,
        title: texte.title,
        reference: texte.reference,
        effectiveOn: texte.effectiveOn,
        published: texte.publishedAt !== null,
        pdf: texte.pdfFilename ? { filename: texte.pdfFilename, size: texte.pdfSize ?? 0 } : null,
        chapters,
        articleCount: articles.length,
      };
    });
  }

  /**
   * La recherche plein texte, en français.
   *
   * C'est elle qui remplace le feuilletage : dans un code de trois cents
   * articles, on ne cherche pas un chapitre, on cherche un mot. `ts_headline`
   * rend les mots AUTOUR de la trouvaille plutôt que l'article entier — trois
   * lignes de contexte suffisent à savoir si c'est le bon.
   *
   * Le surlignage sort en crochets doubles, pas en balises : aucun fragment de
   * HTML ne voyage, et l'écran décide lui-même comment marquer la trouvaille.
   */
  async search(user: SessionUser, slug: string, q: string): Promise<ReferenceSearchHit[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const texte = await this.visible(tx, slug, user);
      const { rows } = await tx.execute<{
        id: string;
        number: number;
        label: string | null;
        title: string | null;
        chapter_id: string;
        chapter_number: number;
        chapter_title: string;
        extrait: string;
      }>(sql`
        SELECT a.id, a.number, a.label, a.title,
               c.id AS chapter_id, c.number AS chapter_number, c.title AS chapter_title,
               ts_headline('french', a.body, plainto_tsquery('french', ${q}),
                 'StartSel=[[, StopSel=]], MaxWords=30, MinWords=14, MaxFragments=1') AS extrait
        FROM reference_articles a
        JOIN reference_chapters c ON c.id = a.chapter_id
        WHERE a.text_id = ${texte.id}
          AND to_tsvector('french', coalesce(a.title, '') || ' ' || a.body)
              @@ plainto_tsquery('french', ${q})
        ORDER BY a.number
        LIMIT 40`);

      return rows.map((r) => ({
        id: r.id,
        numero: numeroArticle(r.number, r.label),
        title: r.title,
        chapterId: r.chapter_id,
        chapterNumero: numeroChapitre(r.chapter_number),
        chapterTitle: r.chapter_title,
        extract: r.extrait,
      }));
    });
  }

  /** Le PDF officiel, celui qui fait foi. */
  async pdf(user: SessionUser, slug: string): Promise<{ filename: string; data: Buffer }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const texte = await this.visible(tx, slug, user);
      if (!texte.pdfFilename || !texte.pdfData) {
        problem(404, 'reference.no_pdf', 'Aucun fichier officiel déposé pour ce texte');
      }
      return { filename: texte.pdfFilename, data: texte.pdfData };
    });
  }

  /**
   * Enregistrer le texte EN ENTIER : métadonnées et contenu, d'un bloc.
   *
   * Un texte de loi ne se corrige pas à la virgule ; il est remplacé par sa
   * version suivante. L'envoi complet dit exactement cela et tient dans une
   * transaction — à aucun moment un employé ne lit un texte à moitié réécrit.
   *
   * Les chapitres et les articles sont RAPPROCHÉS PAR LEUR NUMÉRO plutôt que
   * rasés puis recréés : « Article 47 » garde alors son identifiant d'une
   * version à l'autre, et un lien posé vers lui continue de tomber juste.
   */
  async save(user: SessionUser, slug: string, input: SaveReferenceTextInput): Promise<void> {
    if (!this.redige(user)) {
      problem(403, 'reference.forbidden', 'Seule la RH dépose les textes de référence');
    }
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) {
      problem(422, 'reference.bad_slug', 'Identifiant de texte invalide');
    }
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const [existant] = await tx
        .select({ id: t.referenceTexts.id })
        .from(t.referenceTexts)
        .where(eq(t.referenceTexts.slug, slug))
        .limit(1);

      const textId = existant?.id ?? uuidv7();
      const entete = {
        title: input.title,
        reference: input.reference ?? null,
        effectiveOn: input.effectiveOn ?? null,
        publishedAt: input.published
          ? existant
            ? sql`coalesce(published_at, now())`
            : new Date()
          : null,
        updatedAt: new Date(),
      };
      if (existant) {
        await tx.update(t.referenceTexts).set(entete).where(eq(t.referenceTexts.id, textId));
      } else {
        await tx
          .insert(t.referenceTexts)
          .values({ id: textId, tenantId: user.tenantId, slug, ...entete });
      }

      // Les chapitres d'abord : les sections et les articles s'y accrochent.
      const chapitresGardes: string[] = [];
      const idParNumeroChapitre = new Map<number, string>();
      for (const c of input.chapters) {
        const [dejaLa] = await tx
          .select({ id: t.referenceChapters.id })
          .from(t.referenceChapters)
          .where(
            and(eq(t.referenceChapters.textId, textId), eq(t.referenceChapters.number, c.number)),
          )
          .limit(1);
        const id = dejaLa?.id ?? uuidv7();
        if (dejaLa) {
          await tx
            .update(t.referenceChapters)
            .set({ title: c.title, body: c.body ?? null, updatedAt: new Date() })
            .where(eq(t.referenceChapters.id, id));
        } else {
          await tx.insert(t.referenceChapters).values({
            id,
            tenantId: user.tenantId,
            textId,
            number: c.number,
            title: c.title,
            body: c.body ?? null,
          });
        }
        chapitresGardes.push(id);
        idParNumeroChapitre.set(c.number, id);
      }

      // Sections : rapprochées par (chapitre, numéro).
      const sectionsGardees: string[] = [];
      const idParSection = new Map<string, string>();
      for (const c of input.chapters) {
        const chapterId = idParNumeroChapitre.get(c.number)!;
        for (const s of c.sections) {
          const [dejaLa] = await tx
            .select({ id: t.referenceSections.id })
            .from(t.referenceSections)
            .where(
              and(
                eq(t.referenceSections.chapterId, chapterId),
                eq(t.referenceSections.number, s.number),
              ),
            )
            .limit(1);
          const id = dejaLa?.id ?? uuidv7();
          if (dejaLa) {
            await tx
              .update(t.referenceSections)
              .set({ title: s.title, body: s.body ?? null, updatedAt: new Date() })
              .where(eq(t.referenceSections.id, id));
          } else {
            await tx.insert(t.referenceSections).values({
              id,
              tenantId: user.tenantId,
              chapterId,
              number: s.number,
              title: s.title,
              body: s.body ?? null,
            });
          }
          sectionsGardees.push(id);
          idParSection.set(`${c.number}/${s.number}`, id);
        }
      }

      const articlesGardes: string[] = [];
      for (const c of input.chapters) {
        const chapterId = idParNumeroChapitre.get(c.number)!;
        for (const a of c.articles) {
          const sectionId =
            a.sectionNumber != null
              ? (idParSection.get(`${c.number}/${a.sectionNumber}`) ?? null)
              : null;
          const [dejaLa] = await tx
            .select({ id: t.referenceArticles.id })
            .from(t.referenceArticles)
            .where(
              and(eq(t.referenceArticles.textId, textId), eq(t.referenceArticles.number, a.number)),
            )
            .limit(1);
          const id = dejaLa?.id ?? uuidv7();
          const champs = {
            chapterId,
            sectionId,
            label: a.label ?? null,
            title: a.title ?? null,
            body: a.body,
          };
          if (dejaLa) {
            await tx
              .update(t.referenceArticles)
              .set({ ...champs, updatedAt: new Date() })
              .where(eq(t.referenceArticles.id, id));
          } else {
            await tx.insert(t.referenceArticles).values({
              id,
              tenantId: user.tenantId,
              textId,
              number: a.number,
              ...champs,
            });
          }
          articlesGardes.push(id);
        }
      }

      // Ce qui n'a pas été revu dans cet envoi n'est plus dans le texte. Les
      // chapitres en dernier : leur suppression emporte en cascade les
      // sections et les articles qui en dépendaient encore.
      await tx
        .delete(t.referenceArticles)
        .where(
          articlesGardes.length > 0
            ? and(
                eq(t.referenceArticles.textId, textId),
                notInArray(t.referenceArticles.id, articlesGardes),
              )
            : eq(t.referenceArticles.textId, textId),
        );
      if (chapitresGardes.length > 0) {
        await tx
          .delete(t.referenceSections)
          .where(
            sectionsGardees.length > 0
              ? and(
                  inArray(t.referenceSections.chapterId, chapitresGardes),
                  notInArray(t.referenceSections.id, sectionsGardees),
                )
              : inArray(t.referenceSections.chapterId, chapitresGardes),
          );
      }
      await tx
        .delete(t.referenceChapters)
        .where(
          chapitresGardes.length > 0
            ? and(
                eq(t.referenceChapters.textId, textId),
                notInArray(t.referenceChapters.id, chapitresGardes),
              )
            : eq(t.referenceChapters.textId, textId),
        );
    });
  }

  /** Le dépôt du PDF officiel : celui qui fait foi, à côté du texte lu. */
  async uploadPdf(
    user: SessionUser,
    slug: string,
    input: UploadReferencePdfInput,
  ): Promise<{ size: number }> {
    if (!this.redige(user)) {
      problem(403, 'reference.forbidden', 'Seule la RH dépose les textes de référence');
    }
    const data = Buffer.from(input.contentBase64, 'base64');
    if (data.length === 0 || data.length > MAX_REFERENCE_PDF_BYTES) {
      problem(422, 'reference.too_large', 'Le fichier doit faire 15 Mo maximum');
    }
    // Le type annoncé ne prouve rien : on lit la signature du fichier.
    if (data.subarray(0, 5).toString() !== '%PDF-') {
      problem(422, 'reference.bad_format', 'Le fichier officiel doit être un PDF');
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const res = await tx
        .update(t.referenceTexts)
        .set({
          pdfFilename: input.filename,
          pdfData: data,
          pdfSize: data.length,
          updatedAt: new Date(),
        })
        .where(eq(t.referenceTexts.slug, slug))
        .returning({ id: t.referenceTexts.id });
      if (res.length === 0) {
        problem(404, 'reference.not_found', 'Ce texte n’existe pas encore');
      }
      return { size: data.length };
    });
  }
}
