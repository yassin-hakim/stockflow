import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { InventoryModule } from "./inventory.module";
import { HttpErrorFilter } from "./presentation/http-filter";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const app = await NestFactory.create(InventoryModule);
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}
void main();
