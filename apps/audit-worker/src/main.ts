import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AuditModule } from './audit.module';

async function main(): Promise<void> {
  if (!process.env.NATS_URL || new URL(process.env.NATS_URL).protocol !== 'nats:') throw new Error('NATS_URL is required and must use nats://.');
  const app = await NestFactory.createApplicationContext(AuditModule);
  app.enableShutdownHooks();
}
void main();
