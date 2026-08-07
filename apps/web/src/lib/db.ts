import { connectPostgres, Phase0Store, type PostgresConnection } from "@meaworld/db";
import { getWebEnv } from "./env";

declare global {
  var __meaworldPostgres: PostgresConnection | undefined;
}

export function getConnection(): PostgresConnection {
  globalThis.__meaworldPostgres ??= connectPostgres(getWebEnv().DATABASE_URL, { max: 5 });
  return globalThis.__meaworldPostgres;
}

export function getStore(): Phase0Store {
  return new Phase0Store(getConnection().database);
}
