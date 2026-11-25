import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  type ChatMessagesResponse,
  type ChatSessionList,
  type ChatSessionsQuery,
  chatSessionIdSchema,
  chatSessionsQuerySchema,
} from '@shopping-agent/shared';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ChatSessionService } from './chat-session.service';

/** History/resume endpoints shared by `/help` and (Phase 4) `/assistant`. */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: ChatSessionService) {}

  @Get()
  async list(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Query(new ZodValidationPipe(chatSessionsQuerySchema)) query: ChatSessionsQuery,
  ): Promise<ChatSessionList> {
    const sessions = await this.sessions.listSessions(requireUserId(ctx), query.kind, query.limit);
    return { sessions };
  }

  @Get(':id/messages')
  getMessages(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Param('id', new ZodValidationPipe(chatSessionIdSchema)) id: string,
  ): Promise<ChatMessagesResponse> {
    return this.sessions.getMessages(requireUserId(ctx), id, 200);
  }
}
