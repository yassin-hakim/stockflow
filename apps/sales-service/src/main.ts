import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { SalesModule } from "./sales.module";
import { HttpErrorFilter } from "./presentation/http-filter";
async function main() {
  const port = Number(process.env.PORT ?? 3003);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const app = await NestFactory.create(SalesModule);
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}
void main();
