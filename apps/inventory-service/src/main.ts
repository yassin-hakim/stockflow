import { randomUUID } from "node:crypto";
import { inventoryRequestContext } from "./infrastructure/request-context";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { InventoryModule } from "./inventory.module";
import { HttpErrorFilter } from "./presentation/http-filter";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const app = await NestFactory.create(InventoryModule);
  app.use(
    (
      request: { headers: Record<string, string | undefined> },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      const requestId = request.headers["x-request-id"] || randomUUID();
      request.headers["x-request-id"] = requestId;
      response.setHeader("X-Request-ID", requestId);
      inventoryRequestContext.run({ requestId }, next);
    },
  );
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}
void main();
