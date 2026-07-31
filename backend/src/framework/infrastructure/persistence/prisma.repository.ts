import {
  AggregateRoot,
  EntityNotFound,
  EntityRepository,
  Identity,
} from '@framework/domain';
import { EventBus, IEvent } from '@nestjs/cqrs';
import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service';

export interface ModelDelegate<PModel> {
  findUnique(args: { where: { id: string } }): Promise<PModel | null>;
  upsert(args: {
    where: { id: string };
    create: PModel;
    update: Omit<PModel, 'id'>;
  }): Promise<PModel>;
}

/**
 * Picks this repository's model off whichever client is current. A **selector**
 * rather than the delegate itself, because `prisma.wallet` captured once in a
 * constructor is bound to the connection and would keep writing outside any
 * transaction opened later. Resolving per call is what lets `UnitOfWork` make a
 * repository transactional without the repository knowing.
 */
export type DelegateSelector<PModel> = (
  client: Prisma.TransactionClient,
) => ModelDelegate<PModel>;

export abstract class PrismaEntityRepository<
  T extends AggregateRoot,
  PModel extends { id: string },
> extends EntityRepository<T> {
  constructor(
    private readonly selectDelegate: DelegateSelector<PModel>,
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  /** Always read through this, never through a stored delegate. */
  protected get delegate(): ModelDelegate<PModel> {
    return this.selectDelegate(this.prismaService.client());
  }

  protected abstract toDomain(record: PModel): T;
  protected abstract toPersistence(entity: T): PModel;

  async find(id: Identity): Promise<T | null> {
    const record = await this.delegate.findUnique({
      where: { id: id.asString() },
    });
    return record ? this.toDomain(record) : null;
  }

  async get(id: Identity): Promise<T> {
    const entity = await this.find(id);
    if (!entity) throw EntityNotFound.withId(id);
    return entity;
  }

  async save(entity: T): Promise<void> {
    const data = this.toPersistence(entity);
    const { id, ...updateData } = data;
    await this.delegate.upsert({
      where: { id },
      create: data,
      update: updateData,
    });
    this.eventBus.publishAll(entity.releaseEvents() as IEvent[]);
  }
}
