import "dotenv/config";
import { DataSource } from "typeorm";

/**
 * Standalone DataSource for the TypeORM CLI (migration:run, migration:generate).
 * NestJS uses app.module.ts → TypeOrmModule.forRootAsync instead.
 *
 * Usage:
 *   npm run migration:run       — apply pending migrations
 *   npm run migration:generate  — generate a new migration from entity diff
 */
export const AppDataSource = new DataSource({
	type: "postgres",
	host: process.env.POSTGRES_HOST ?? "localhost",
	port: Number(process.env.POSTGRES_PORT ?? 5432),
	username: process.env.POSTGRES_USER,
	password: process.env.POSTGRES_PASSWORD,
	database: process.env.POSTGRES_DB,
	entities: [__dirname + "/**/*.entity{.ts,.js}"],
	migrations: [__dirname + "/migrations/**/*{.ts,.js}"],
	synchronize: false,
	logging: process.env.NODE_ENV === "development",
});

export default AppDataSource;
