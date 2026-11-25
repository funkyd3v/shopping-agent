import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  type ProductDetail,
  type ProductList,
  type ProductListQuery,
  productIdParamSchema,
  productListQuerySchema,
} from '@shopping-agent/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProductSearchService } from './product-search.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductSearchService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<ProductList> {
    return this.products.search(query);
  }

  @Get(':id')
  get(
    @Param('id', new ZodValidationPipe(productIdParamSchema)) id: string,
  ): Promise<ProductDetail> {
    return this.products.getById(id);
  }
}
