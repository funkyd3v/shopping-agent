import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatModule } from '../chat/chat.module';
import { getEnv } from '../config/env';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { ModelGatewayModule } from '../model-gateway/model-gateway.module';
import { OrdersModule } from '../orders/orders.module';
import { AGENT_CHECKPOINTER, SqliteAgentCheckpointer } from './agent.checkpointer';
import { AgentController } from './agent.controller';
import type { AgentTuning } from './agent.policy';
import { AGENT_TUNING, AgentService } from './agent.service';
import { AgentToolRegistry } from './agent.tools';
import { AgentRunService } from './agent-run.service';

@Module({
  imports: [
    ModelGatewayModule,
    ChatModule,
    GuardrailsModule,
    CatalogModule,
    CartModule,
    OrdersModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentToolRegistry,
    AgentRunService,
    SqliteAgentCheckpointer,
    {
      provide: AGENT_CHECKPOINTER,
      useFactory: (checkpointer: SqliteAgentCheckpointer) => checkpointer.saver,
      inject: [SqliteAgentCheckpointer],
    },
    {
      provide: AGENT_TUNING,
      // Env is validated before modules initialize (main.ts), so this is safe.
      useFactory: (): AgentTuning => {
        const env = getEnv();
        return {
          maxModelCallsPerRun: env.AGENT_MAX_MODEL_CALLS,
          maxToolCallsPerRun: env.AGENT_MAX_TOOL_CALLS,
          routerMinConfidence: env.AGENT_ROUTER_MIN_CONFIDENCE,
        };
      },
    },
  ],
})
export class AgentModule implements OnApplicationShutdown {
  constructor(private readonly checkpointer: SqliteAgentCheckpointer) {}

  onApplicationShutdown(): void {
    this.checkpointer.onApplicationShutdown();
  }
}
