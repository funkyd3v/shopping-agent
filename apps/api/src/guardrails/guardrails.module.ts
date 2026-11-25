import { Module } from '@nestjs/common';
import { GuardrailService } from './guardrail.service';
import { TokenBudgetService } from './token-budget.service';

@Module({
  providers: [GuardrailService, TokenBudgetService],
  exports: [GuardrailService, TokenBudgetService],
})
export class GuardrailsModule {}
