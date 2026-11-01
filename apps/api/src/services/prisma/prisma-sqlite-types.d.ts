import '@prisma/client';

declare module '@prisma/client' {
  namespace Prisma {
    interface StringFilter {
      mode?: 'default' | 'insensitive';
    }
    interface NestedStringFilter {
      mode?: 'default' | 'insensitive';
    }
    interface StringNullableFilter {
      mode?: 'default' | 'insensitive';
    }
    interface NestedStringNullableFilter {
      mode?: 'default' | 'insensitive';
    }
  }
}
