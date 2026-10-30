import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PRE_BEALE_DATA_DIRECTORY_NAME } from "./legacy-compatibility.js";
import { defaultSourceRepositoryStoreDirectory } from "./source-materializer.js";

function within(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot));
}

/** Managed checkouts live below the Beale data directory; other runtime data is not source. */
export function assertRepositorySourceRoot(root: string): void {
  const canonicalRoot = resolve(root);
  const parts = canonicalRoot.split(sep);
  const configuredStore = defaultSourceRepositoryStoreDirectory();
  let canonicalStore: string;
  try { canonicalStore = realpathSync(configuredStore); }
  catch { canonicalStore = resolve(configuredStore); }
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]?.toLowerCase();
    if (part !== ".beale" && part !== PRE_BEALE_DATA_DIRECTORY_NAME) continue;
    const dataRoot = parts.slice(0, index + 1).join(sep) || sep;
    const defaultStore = resolve(dataRoot, "repositories");
    if (!((canonicalStore !== dataRoot && within(canonicalStore, canonicalRoot))
      || within(defaultStore, canonicalRoot))) {
      throw new Error("Repository source tools cannot inspect Beale runtime data outside managed checkouts.");
    }
  }
}
