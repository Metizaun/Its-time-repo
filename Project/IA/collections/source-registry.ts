import type { CollectionSourceMapper } from "./domain.js";

export class CollectionSourceRegistry {
  private readonly mappers = new Map<string, CollectionSourceMapper<unknown>>();

  register<TInput>(mapper: CollectionSourceMapper<TInput>) {
    if (this.mappers.has(mapper.sourceType)) {
      throw new Error(`Adaptador de cobranca duplicado: ${mapper.sourceType}`);
    }
    this.mappers.set(mapper.sourceType, mapper as CollectionSourceMapper<unknown>);
    return this;
  }

  get<TInput>(sourceType: string): CollectionSourceMapper<TInput> {
    const mapper = this.mappers.get(sourceType);
    if (!mapper) throw new Error(`Adaptador de cobranca nao registrado: ${sourceType}`);
    return mapper as CollectionSourceMapper<TInput>;
  }

  list() {
    return Array.from(this.mappers.values()).map((mapper) => ({
      sourceType: mapper.sourceType,
      capabilities: mapper.capabilities,
    }));
  }
}
