import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrderDetail, OrderList, OrderListQuery } from '@shopping-agent/shared';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { decodeOrderCursor, encodeOrderCursor } from './order.cursor';
import { toOrderDetail, toOrderSummary } from './order.mapper';

/**
 * Read-only order access for REST now; Phase 6 extends this service with
 * placement, checkout, and cancellation. Every query is scoped by user id.
 */
@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, query: OrderListQuery): Promise<OrderList> {
    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) where.status = query.status;

    if (query.cursor) {
      const cursor = decodeOrderCursor(query.cursor);
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((order) => toOrderSummary(order)),
      nextCursor: hasMore && last ? encodeOrderCursor(last) : null,
    };
  }

  async getForUser(userId: string, orderId: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) {
      // Another user's order is indistinguishable from a missing order (PLAN §9.6).
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found.' });
    }
    return toOrderDetail(order);
  }
}
