import { Module } from '@nestjs/common';
import { ProductSearchService } from './product-search.service';
import { ProductsController } from './products.controller';

@Module({
  controllers: [ProductsController],
  providers: [ProductSearchService],
  exports: [ProductSearchService],
})
export class CatalogModule {}
