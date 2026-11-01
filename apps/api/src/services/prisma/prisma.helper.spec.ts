import {
  createManySkippingDuplicates,
  sqliteAllOperations,
  sqliteCompatibilityExtension,
  stripModeInsensitive
} from './prisma.helper';

describe('stripModeInsensitive', () => {
  it('should handle null, undefined, and primitives gracefully', () => {
    expect(stripModeInsensitive(null)).toBeNull();
    expect(stripModeInsensitive(undefined)).toBeUndefined();
    expect(stripModeInsensitive(42)).toBe(42);
    expect(stripModeInsensitive('string')).toBe('string');
    expect(stripModeInsensitive(true)).toBe(true);
  });

  it('should leave objects without mode untouched', () => {
    const input = {
      where: {
        id: '123',
        status: 'ACTIVE'
      }
    };
    const result = stripModeInsensitive(input);
    expect(result).toStrictEqual({
      where: {
        id: '123',
        status: 'ACTIVE'
      }
    });
  });

  it('should strip mode: insensitive from simple string filters', () => {
    const input = {
      name: {
        mode: 'insensitive',
        startsWith: 'AAPL'
      }
    };
    const result = stripModeInsensitive(input);
    expect(result).toStrictEqual({
      name: {
        startsWith: 'AAPL'
      }
    });
  });

  it('should strip mode: default from filters', () => {
    const input = {
      symbol: {
        mode: 'default',
        equals: 'MSFT'
      }
    };
    const result = stripModeInsensitive(input);
    expect(result).toStrictEqual({
      symbol: {
        equals: 'MSFT'
      }
    });
  });

  it('should strip mode across array elements in OR/AND clauses', () => {
    const input = {
      OR: [
        { id: { mode: 'insensitive', startsWith: 'foo' } },
        { name: { mode: 'insensitive', startsWith: 'foo' } },
        { symbol: { mode: 'default', contains: 'bar' } }
      ]
    };
    const result = stripModeInsensitive(input);
    expect(result).toStrictEqual({
      OR: [
        { id: { startsWith: 'foo' } },
        { name: { startsWith: 'foo' } },
        { symbol: { contains: 'bar' } }
      ]
    });
  });

  it('should strip mode in deeply nested relation filters', () => {
    const input = {
      where: {
        SymbolProfile: {
          name: {
            mode: 'insensitive',
            startsWith: 'Tesla'
          },
          activities: {
            some: {
              comment: {
                mode: 'insensitive',
                contains: 'rebalance'
              }
            }
          }
        }
      }
    };
    const result = stripModeInsensitive(input);
    expect(result).toStrictEqual({
      where: {
        SymbolProfile: {
          name: {
            startsWith: 'Tesla'
          },
          activities: {
            some: {
              comment: {
                contains: 'rebalance'
              }
            }
          }
        }
      }
    });
  });
});

describe('createManySkippingDuplicates', () => {
  const duplicate = Object.assign(new Error('unique'), { code: 'P2002' });

  it('should strip skipDuplicates and insert the batch in one call', async () => {
    const query = jest.fn().mockResolvedValue({ count: 2 });

    const result = await createManySkippingDuplicates(
      { data: [{ id: 1 }, { id: 2 }], skipDuplicates: true },
      query
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ data: [{ id: 1 }, { id: 2 }] });
    expect(result).toEqual({ count: 2 });
  });

  it('should fall back to row-by-row inserts and skip duplicates', async () => {
    const query = jest
      .fn()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({ count: 1 });

    const result = await createManySkippingDuplicates(
      { data: [{ id: 1 }, { id: 2 }, { id: 3 }], skipDuplicates: true },
      query
    );

    expect(result).toEqual({ count: 2 });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('should rethrow errors other than unique violations', async () => {
    const query = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      createManySkippingDuplicates(
        { data: [{ id: 1 }], skipDuplicates: true },
        query
      )
    ).rejects.toThrow('boom');
  });
});

describe('sqliteCompatibilityExtension', () => {
  const allOperations = sqliteAllOperations;

  it('should be defined with the expected extension structure', () => {
    expect(sqliteCompatibilityExtension).toBeDefined();
    expect(allOperations).toBeDefined();
  });

  it('should intercept operations and strip mode in query args', async () => {
    const query = jest.fn().mockResolvedValue(['result']);
    const args = {
      where: { name: { mode: 'insensitive', startsWith: 'AAPL' } }
    };

    const result = await allOperations({ args, operation: 'findMany', query });

    expect(query).toHaveBeenCalledWith({
      where: { name: { startsWith: 'AAPL' } }
    });
    expect(result).toEqual(['result']);
  });

  it('should route createMany with skipDuplicates through the emulation', async () => {
    const query = jest.fn().mockResolvedValue({ count: 1 });

    await allOperations({
      args: { data: [{ id: 1 }], skipDuplicates: true },
      operation: 'createMany',
      query
    });

    expect(query).toHaveBeenCalledWith({ data: [{ id: 1 }] });
  });
});
