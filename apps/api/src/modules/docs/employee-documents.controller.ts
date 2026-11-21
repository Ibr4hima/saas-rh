import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  replaceEmployeeDocumentSchema,
  reviewEmployeeDocumentSchema,
  uploadEmployeeDocumentSchema,
  type ReplaceEmployeeDocumentInput,
  type ReviewEmployeeDocumentInput,
  type UploadEmployeeDocumentInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { EmployeeDocumentsService } from './employee-documents.service';
import { contentDisposition } from '../../common/telechargement';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class EmployeeDocumentsController {
  constructor(
    @Inject(EmployeeDocumentsService) private readonly documents: EmployeeDocumentsService,
  ) {}

  @Post('employees/:id/documents')
  upload(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(uploadEmployeeDocumentSchema)) body: UploadEmployeeDocumentInput,
  ) {
    return this.documents.upload(req.sessionUser, id, body);
  }

  /** La file de la DCH : les pièces déposées par les agents, à vérifier. */
  @Get('employee-documents/a-verifier')
  file(@Req() req: AuthenticatedRequest) {
    return this.documents.file(req.sessionUser);
  }

  @Get('employees/:id/documents')
  list(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.list(req.sessionUser, id);
  }

  @Post('employee-documents/:id/review')
  @HttpCode(204)
  async review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewEmployeeDocumentSchema)) body: ReviewEmployeeDocumentInput,
  ) {
    await this.documents.review(req.sessionUser, id, body);
  }

  /** Aperçu dans la page par défaut ; ?download=1 force le téléchargement. */
  @Get('employee-documents/:id/content')
  async content(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.documents.content(req.sessionUser, id);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(download ? 'attachment' : 'inline', doc.filename),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(doc.data);
  }

  /** Changer le fichier d'un dépôt en vérification — son titulaire seul. */
  @Put('employee-documents/:id')
  @HttpCode(204)
  async replace(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(replaceEmployeeDocumentSchema))
    body: ReplaceEmployeeDocumentInput,
  ) {
    await this.documents.replace(req.sessionUser, id, body);
  }

  @Delete('employee-documents/:id')
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(req.sessionUser, id);
  }
}
