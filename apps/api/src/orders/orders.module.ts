import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { CheckoutService } from './checkout.service';
import { OrderService } from './order.service';
import { OrderWriteService } from './order-write.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [GuardrailsModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderWriteService, CheckoutService],
  exports: [OrderService, OrderWriteService, CheckoutService],
})
export class OrdersModule {}
