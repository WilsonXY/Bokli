import supported from "../../drizzle/bootstrap-supported.json";

/** Pure data contracts, without database/file/network I/O. Production bootstrap
 * and reverse-converter tooling, private storage and installation belong later.
 */
export interface MigrationArtifact {
  tag: string;
  when: number;
  sqlHash: string;
  snapshotHash: string;
}
export interface BaselineManifest {
  id: string;
  migrations: readonly MigrationArtifact[];
}
export function assertPinnedArtifacts(manifest: BaselineManifest, observed: readonly MigrationArtifact[]): void {
  if (JSON.stringify(observed) !== JSON.stringify(manifest.migrations)) {
    throw new Error("Pinned migration artifacts changed");
  }
}
export function assertExpansionBoundary(
  manifest: BaselineManifest,
  observed: readonly MigrationArtifact[],
  marker: { manifestId: string; phase: string },
): void {
  if (marker.phase !== "import-verified" || marker.manifestId !== manifest.id) {
    throw new Error("Bootstrap expansion requires the pinned baseline and a verified import marker");
  }
  assertPinnedArtifacts(manifest, observed);
}

type Cell = string | number | null;
export interface ImageTable {
  name: string;
  sql: string;
  columns: string[];
  rows: Record<string, Cell>[];
}
export interface DatabaseImage {
  tables: ImageTable[];
  objects: { type: "index" | "trigger"; name: string; sql: string }[];
  /** Decimal strings carry SQLite's full signed-64-bit high-water marks. */
  sequences: { name: string; seq: number | string }[];
}
const migrationTables = new Set(["__drizzle_migrations", "d1_migrations"]);
export function sequenceInteger(value: number | string): bigint {
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) {
    throw new Error("Unsafe sequence encoding");
  }
  const integer = BigInt(value);
  if (integer > 9223372036854775807n) throw new Error("Unsafe sequence encoding");
  return integer;
}

/** Project onto the actual frozen schema, not an assumed old release. Frozen
 * migration bookkeeping belongs to that schema; expanded bookkeeping and all
 * receipts/actor fields stay losslessly in a PRIVATE sidecar. No receipt GC.
 */
export async function reverseForLegacy(expanded: DatabaseImage, frozen: DatabaseImage): Promise<{
  legacy: DatabaseImage;
  privateSidecar: DatabaseImage;
}> {
  await supportedLayout(expanded);
  await supportedLayout(frozen);
  const tables = frozen.tables.map(target => {
    if (migrationTables.has(target.name)) return structuredClone(target);
    const source = expanded.tables.find(table => table.name === target.name);
    if (!source) throw new Error(`Missing frozen table: ${target.name}`);
    if (target.name === "database_state") {
      const state = source.rows[0];
      const original = target.rows[0];
      if (source.rows.length !== 1 || target.rows.length !== 1 || state.id !== 1 || original.id !== 1 ||
        !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(original.revision) ||
        Number(state.revision) < 0 || Number(original.revision) < 0) throw new Error("Invalid restore control state");
      const revision = Math.max(Number(state.revision), Number(original.revision)) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error("Restore revision exhausted");
      // New offline destination, not a write to either captured source. Its own
      // maintenance barrier remains closed; source ownership stays in sidecar.
      return { ...structuredClone(target), rows: [{ ...state, schema_epoch: original.schema_epoch,
        revision, maintenance: 1, backup_token: null }] };
    }
    const rows = source.rows.map(row => {
      const original = target.name === "users" && (row.username == null || row.password_hash == null)
        ? target.rows.find(old => String(old.id) === String(row.id)) : undefined;
      const projected: Record<string, Cell> = {};
      for (const column of target.columns) {
        const credential = target.name === "users" && ["username", "password_hash"].includes(column);
        const value = credential && row[column] == null ? original?.[column] : row[column];
        if (value === undefined || (credential && value === null)) {
          throw new Error(`Missing frozen column: ${target.name}.${column}`);
        }
        projected[column] = value;
      }
      return projected;
    });
    return { ...structuredClone(target), rows };
  });
  const tableNames = new Set(tables.map(table => table.name));
  const sequences = frozen.sequences.map(sequence => {
    if (migrationTables.has(sequence.name)) return { ...sequence };
    const source = expanded.sequences.find(s => s.name === sequence.name);
    if (!source) throw new Error(`Missing expanded sequence: ${sequence.name}`);
    return { name: sequence.name, seq: sequenceInteger(sequence.seq) > sequenceInteger(source.seq) ? sequence.seq : source.seq };
  });
  // New AUTOINCREMENT tables already present in a newer frozen schema also count.
  for (const sequence of expanded.sequences) if (tableNames.has(sequence.name) &&
    !sequences.some(s => s.name === sequence.name)) {
    sequenceInteger(sequence.seq);
    sequences.push({ ...sequence });
  }
  return {
    legacy: { tables, objects: structuredClone(frozen.objects), sequences },
    privateSidecar: structuredClone(expanded),
  };
}

/** Exact private read-back marker. The later authorized tool issues this only
 * after schema/content/FK/integrity/metadata/sequence/receipt verification and
 * the rollback ingress barrier. It is a caller assertion, not authentication.
 */
export async function imageDigest(image: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(image)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function assertRestoreHandoff(
  planned: DatabaseImage, observed: DatabaseImage,
  marker: { phase: string; imageHash: string; authorized: boolean; destinationOffline: boolean },
): Promise<void> {
  await supportedLayout(planned);
  const expected = await imageDigest(planned);
  const state = planned.tables.find(t => t.name === "database_state");
  if (marker.phase !== "restore-verified" || !marker.authorized || !marker.destinationOffline ||
    marker.imageHash !== expected || await imageDigest(observed) !== expected ||
    (state && (state.rows.length !== 1 || state.rows[0].maintenance !== 1 || state.rows[0].backup_token !== null))) {
    throw new Error("Restore handoff requires exact verified read-back and authorized offline destination");
  }
}

/** Only inventory-pinned 0008/0009 schemas; platform migration tables have
 * explicit engine-specific definitions and actual applied-artifact checks.
 * Full data/FK/integrity verification still belongs to the marker issuer.
 */
export async function supportedLayout(image: DatabaseImage): Promise<BaselineManifest> {
  const schema = {
    tables: image.tables.filter(t => !migrationTables.has(t.name)).map(({ name, sql, columns }) => ({ name, sql, columns })).sort((a,b) => a.name.localeCompare(b.name)),
    objects: [...image.objects].sort((a,b) => a.name.localeCompare(b.name)),
  };
  const hash = await imageDigest(schema);
  const layout = supported.layouts.find(candidate => candidate.schemaHash === hash);
  if (!layout) throw new Error("Unsupported database layout: schema inventory is not pinned");
  const metadata = image.tables.filter(t => migrationTables.has(t.name));
  const table = metadata[0];
  if (metadata.length !== 1 || !table || table.rows.length !== layout.migrations.length) throw new Error("Migration inventory missing or incompatible");
  const columns = table.name === "d1_migrations" ? ["id","name","applied_at"] : ["id","hash","created_at"];
  if (JSON.stringify(table.columns) !== JSON.stringify(columns)) throw new Error("Migration inventory columns are incompatible");
  const schemas = supported.metadataSchemas[table.name as keyof typeof supported.metadataSchemas];
  if (!schemas?.includes(table.sql.replace(/\s+/g, " ").trim())) throw new Error("Migration inventory schema is not pinned");
  const rows = [...table.rows].sort((a,b) => table.name === "d1_migrations" ? Number(a.id)-Number(b.id) : Number(a.created_at)-Number(b.created_at));
  for (const [i, entry] of layout.migrations.entries()) {
    const row = rows[i];
    if (table.name === "d1_migrations" ? row.name !== `${entry.tag}.sql` || typeof row.applied_at !== "string" || !row.applied_at : row.hash !== entry.sqlHash || row.created_at !== entry.when) {
      throw new Error("Migration inventory does not match pinned artifacts");
    }
  }
  const state = image.tables.find(t => t.name === "database_state");
  if (state) {
    const row = state.rows[0];
    if (state.rows.length !== 1 || row.id !== 1 || !Number.isSafeInteger(row.revision) || Number(row.revision)<0 ||
      !Number.isSafeInteger(row.schema_epoch) || Number(row.schema_epoch)<1 || (row.maintenance !== 0 && row.maintenance !== 1) ||
      (row.backup_token !== null && (typeof row.backup_token !== "string" || !row.backup_token.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "")))) {
      throw new Error("Invalid restore control state");
    }
  }
  const names = new Set(image.tables.filter(t => t.sql.includes("AUTOINCREMENT")).map(t => t.name));
  const seen = new Set<string>();
  for (const seq of image.sequences) {
    if (!names.has(seq.name) || seen.has(seq.name)) throw new Error("Unsupported sequence inventory");
    seen.add(seq.name); sequenceInteger(seq.seq);
  }
  for (const table of image.tables.filter(t => names.has(t.name))) {
    if (table.rows.length && !seen.has(table.name)) throw new Error(`Missing expanded sequence: ${table.name}`);
    const sequence = image.sequences.find(s => s.name === table.name);
    for (const row of table.rows) {
      if ((typeof row.id === "number" && !Number.isSafeInteger(row.id)) || !/^-?\d+$/.test(String(row.id))) {
        throw new Error("Unsafe row ID encoding");
      }
      if (sequence && BigInt(String(row.id)) > sequenceInteger(sequence.seq)) throw new Error("Sequence below existing IDs");
    }
  }
  return layout;
}
