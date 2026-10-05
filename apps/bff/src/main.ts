import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { BffModule } from "./bff.module";
import { HttpErrorFilter } from "./http-filter";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const app = await NestFactory.create(BffModule);
  app.use(
    (
      request: { headers: Record<string, string | undefined> },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      const id = randomUUID();
      request.headers["x-request-id"] = id;
      response.setHeader("X-Request-ID", id);
      next();
    },
  );
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}
void main();
