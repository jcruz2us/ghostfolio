import {
  Injectable,
  Logger,
  LogLevel,
  OnApplicationShutdown,
  OnModuleInit
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';

import { sqliteCompatibilityExtension } from './prisma.helper';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown, OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  public constructor(configService: ConfigService) {
    const url = configService.get<string>('DATABASE_URL');
    const isSqlite = url?.startsWith('file:');

    let adapter: any;
    if (isSqlite) {
      const dbFile = url.replace('file:', '');
      const sqlite = new Database(dbFile);
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('busy_timeout = 5000');
      adapter = new PrismaBetterSqlite3(sqlite as any);
    } else {
      adapter = new PrismaPg({ connectionString: url });
    }

    let customLogLevels: LogLevel[] | undefined;

    try {
      customLogLevels = JSON.parse(
        configService.get<string>('LOG_LEVELS')
      ) as LogLevel[];
    } catch {}

    const log: Prisma.LogDefinition[] =
      customLogLevels?.includes('debug') || customLogLevels?.includes('verbose')
        ? [{ emit: 'stdout', level: 'query' }]
        : [];

    super({
      adapter,
      log,
      errorFormat: 'colorless'
    });

    if (isSqlite) {
      const extended = this.$extends(sqliteCompatibilityExtension);
      return new Proxy(this, {
        get(target, prop, receiver) {
          return (
            Reflect.get(extended, prop) ?? Reflect.get(target, prop, receiver)
          );
        }
      });
    }
  }

  public async onApplicationShutdown() {
    await this.$disconnect();
  }

  public async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(error);
    }
  }
}
