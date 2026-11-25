import { Module } from '@nestjs/common';
import { ChatSessionService } from './chat-session.service';
import { SessionsController } from './sessions.controller';

@Module({
  controllers: [SessionsController],
  providers: [ChatSessionService],
  exports: [ChatSessionService],
})
export class ChatModule {}
