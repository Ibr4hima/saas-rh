import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SaveReferenceTextInput, UploadReferencePdfInput } from '@teranga/contracts';
import {
  referenceSearchSchema,
  saveReferenceTextSchema,
  uploadReferencePdfSchema,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ReferenceTextsService } from './reference-texts.service';

/**
 * Les textes de référence se lisent SANS condition de rôle.
 *
 * C'est tout l'objet du module : un règlement intérieur que seule la RH peut
 * ouvrir ne s'oppose à personne, et un code du travail réservé aux
 * gestionnaires ne protège personne. Tout membre authentifié du tenant y a
 * droit ; le filtre qui reste est celui du brouillon, tenu par le service.
 */
@Controller('reference-texts')
@UseGuards(SessionGuard, RolesGuard)
export class ReferenceTextsController {
  constructor(@Inject(ReferenceTextsService) private readonly textes: ReferenceTextsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.textes.list(req.sessionUser);
  }

  @Get(':slug')
  get(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.textes.get(req.sessionUser, slug);
  }

  @Get(':slug/recherche')
  search(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(referenceSearchSchema)) query: { q: string },
  ) {
    return this.textes.search(req.sessionUser, slug, query.q);
  }

  @Get(':slug/pdf')
  async pdf(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    // « inline » ouvre le fichier dans notre lecteur ; sans lui, il descend
    // dans les téléchargements. Le même fichier, deux gestes différents.
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, data } = await this.textes.pdf(req.sessionUser, slug);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition === 'inline' ? 'inline' : 'attachment'}; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(data);
  }

  /** Le texte s'enregistre en entier : métadonnées et contenu, d'un bloc. */
  @Put(':slug')
  @Roles('admin', 'hr')
  save(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(saveReferenceTextSchema)) body: SaveReferenceTextInput,
  ) {
    return this.textes.save(req.sessionUser, slug, body);
  }

  /** Le PDF officiel, déposé à côté du texte lu. */
  @Post(':slug/pdf')
  @Roles('admin', 'hr')
  uploadPdf(
    @Req() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(uploadReferencePdfSchema)) body: UploadReferencePdfInput,
  ) {
    return this.textes.uploadPdf(req.sessionUser, slug, body);
  }
}
