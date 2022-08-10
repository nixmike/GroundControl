import { DataSource } from "typeorm";
import { parse } from "url";

export function getDataSource() {
  if (!process.env.JAWSDB_MARIA_URL) {
    console.error("JAWSDB_MARIA_URL env var not set.");
    process.exit();
  }
  const parsed = parse(process.env.JAWSDB_MARIA_URL);

  return new DataSource({
    type: "mariadb",
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : undefined,
    username: parsed.auth.split(":")[0],
    password: parsed.auth.split(":")[1],
    database: parsed.path.replace("/", ""),
    synchronize: true,
    logging: false,
    entities: ["src/entity/**/*.ts"],
    migrations: ["src/migration/**/*.ts"],
    subscribers: ["src/subscriber/**/*.ts"],
  });
}
