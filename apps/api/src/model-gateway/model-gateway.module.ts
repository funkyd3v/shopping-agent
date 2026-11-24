import { Module } from '@nestjs/common';
import { CassetteStore } from './cassette.store';
import { GatewayController } from './gateway.controller';
import { ModelGatewayService } from './model-gateway.service';

@Module({
  controllers: [GatewayController],
  providers: [CassetteStore, ModelGatewayService],
  exports: [ModelGatewayService],
})
export class ModelGatewayModule {}
