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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  reviewEmployeeDocumentSchema,
  uploadEmployeeDocumentSchema,
  type ReviewEmployeeDocumentInput,
  type UploadEmployeeDocumentInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { EmployeeDocumentsService } from './employee-documents.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
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
      `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(doc.data);
  }

  @Delete('employee-documents/:id')
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(req.sessionUser, id);
  }
}
