/** Authored declaration for the local-only operational helper. */
export function localDatabaseTarget(connectionString: string, runtime?: string): {
  host: string; port: string; database: string; user: string; password: string; sslmode: string;
};
